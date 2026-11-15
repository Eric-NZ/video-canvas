package service

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"go.uber.org/zap"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/pkg/logger"
	"video-canvas/internal/provider"
	"video-canvas/internal/provider/modelcfg"
	"video-canvas/internal/repository"
	"video-canvas/internal/stepkit"
	"video-canvas/internal/storyboard"
)

// splitTimeout 是一次拆分镜（含重写一次）的最长等待；须小于服务端 write_timeout（默认 60s），否则响应会被连接超时截断。
const splitTimeout = 50 * time.Second

// StoryboardRepo 是拆分镜要的存储：确认画布归属，在事务里检查余额和扣费。
type StoryboardRepo interface {
	CanvasOwned(ctx context.Context, userID, canvasID uint64) error
	WithTx(ctx context.Context, fn func(repository.StoryboardTx) error) error
}

// StoryboardDeps 是拆分镜服务的依赖。
type StoryboardDeps struct {
	Repo    StoryboardRepo
	Models  provider.Registry
	Caller  stepkit.Caller   // 文本模型调用（和营销环节共用一个）
	Credits StepCreditPolicy // 新账户初始积分
}

// StoryboardService 是画布分镜表的「从剧本拆分镜」：同步调 Agent 模型，按实际用量扣费，失败不扣。
type StoryboardService struct {
	repo      StoryboardRepo
	models    provider.Registry
	runner    *stepkit.Runner
	credits   StepCreditPolicy
	splitting sync.Map // 进行中的拆分镜：画布 id + 节点 id，同一张表同时只拆一次
}

// NewStoryboardService 创建拆分镜服务。
func NewStoryboardService(d StoryboardDeps) *StoryboardService {
	return &StoryboardService{repo: d.Repo, models: d.Models, runner: stepkit.NewRunner(d.Caller), credits: d.Credits}
}

// Split 把剧本拆成镜头：校验剧本和画布归属 → 选模型 → 按预估查余额 → 调模型（不合格带原因重写一次）→ 按实际用量扣费。
// 结果不写画布：前端拿到镜头后按用户选的覆盖 / 追加写进分镜表，走画布自动保存和撤销。
func (s *StoryboardService) Split(ctx context.Context, userID, canvasID uint64, req *model.StoryboardSplitReq) (*model.StoryboardSplitResp, error) {
	// 1. 剧本：去掉首尾空白后不能为空、不能太长
	script := strings.TrimSpace(req.Script)
	if script == "" {
		return nil, errcode.ErrStoryboardScriptEmpty
	}
	if utf8.RuneCountInString(script) > storyboard.ScriptMax {
		return nil, errcode.ErrStoryboardScriptTooLong
	}
	// 2. 画布必须是自己的：流水关联这张画布
	if err := s.repo.CanvasOwned(ctx, userID, canvasID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, errcode.ErrCanvasNotFound
		}
		return nil, err
	}
	// 3. 同一张分镜表同时只拆一次：重复点击、多标签页并发时直接告诉用户正在拆，不重复花模型调用
	key := strconv.FormatUint(canvasID, 10) + ":" + req.NodeID
	if _, busy := s.splitting.LoadOrStore(key, struct{}{}); busy {
		return nil, errcode.ErrStoryboardSplitBusy
	}
	defer s.splitting.Delete(key)
	snap, err := s.pickModel(ctx, req.Model)
	if err != nil {
		return nil, err
	}
	step := storyboard.SplitStep()
	method := stepkit.BuiltinMethod(step)
	in := storyboard.SplitInput(script)
	// 4. 调模型前按预估（含重写一次）查可用积分：不够就不调，免得做完了扣不到钱
	if err := s.checkBalance(ctx, userID, snap, step, method, in); err != nil {
		return nil, err
	}
	// 拆分镜是一次同步运行：开始、每次模型调用、结束都进日志，run_id 是画布编号
	ctx, run := logger.BeginRun(ctx, logger.RunRef{Kind: "storyboard_split", ID: idcodec.Encode(canvasID), UserID: userID})
	run.Start(zap.String("node_id", req.NodeID), zap.String("model_key", snap.Model.Key), zap.Int("script_chars", utf8.RuneCountInString(script)))
	callCtx, cancel := context.WithTimeout(ctx, splitTimeout)
	defer cancel()
	res, err := s.runner.Run(callCtx, step, method, snap, in)
	if err != nil {
		err = splitError(err)
		run.End(logger.StatusFailed, zap.String("error", err.Error()))
		return nil, err
	}
	shots, err := storyboard.DecodeShots(res.Output)
	if err != nil {
		run.End(logger.StatusFailed, zap.String("error", err.Error()))
		return nil, errcode.ErrStoryboardSplitFailed
	}
	// 5. 成功才扣费：按实际用量结算，封顶在当时的可用积分
	charged, err := s.charge(ctx, userID, canvasID, max(stepkit.Cost(snap, res), 0))
	if err != nil {
		run.End(logger.StatusFailed, zap.String("error", err.Error()))
		return nil, err
	}
	run.End(logger.StatusSucceeded, zap.Int("shots", len(shots)), zap.Int("credits", charged), zap.Int("attempts", res.Attempts))
	return &model.StoryboardSplitResp{Shots: toModelShots(shots), Credits: charged, Model: snap.Model.Key}, nil
}

// pickModel 取用户选的 Agent 模型；没选、已下架或不是 Agent 模型时回落到第一个可用的。
func (s *StoryboardService) pickModel(ctx context.Context, want string) (*provider.Snapshot, error) {
	list, err := s.models.ListModels(ctx, modelcfg.KindAgent)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(list)+1)
	if want != "" {
		keys = append(keys, want)
	}
	for _, m := range list {
		if m.Key != want {
			keys = append(keys, m.Key)
		}
	}
	for _, k := range keys {
		snap, err := s.models.Snapshot(ctx, k)
		if errors.Is(err, provider.ErrModelUnavailable) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if snap != nil && snap.Model.Kind == modelcfg.KindAgent {
			return snap, nil
		}
	}
	return nil, errcode.ErrStoryboardNoModel
}

// checkBalance 按预估费用检查可用积分（余额减冻结）；没有账户时按新账户初始积分惰性建立。只读一眼，不冻结。
func (s *StoryboardService) checkBalance(ctx context.Context, userID uint64, snap *provider.Snapshot, step stepkit.Step, method stepkit.Method, in stepkit.Input) error {
	need, err := stepkit.Estimate(snap, step, method, in)
	if err != nil {
		return err
	}
	if need <= 0 {
		return nil
	}
	initial, err := s.credits.InitialCredits(ctx)
	if err != nil {
		return err
	}
	return s.repo.WithTx(ctx, func(tx repository.StoryboardTx) error {
		if err := tx.EnsureCredit(ctx, userID, initial); err != nil {
			return err
		}
		credit, err := tx.LockCredit(ctx, userID)
		if err != nil {
			return err
		}
		if credit.Balance-credit.Frozen < need {
			return errcode.ErrInsufficientCredits
		}
		return nil
	})
}

// charge 在账户锁内扣拆分镜费：实扣封顶在可用积分，不扣成负数、不动进行中任务冻结的积分；
// 和其他同步文本调用一样成对写一条冻结流水和一条结算流水（金额相同），后台对账等式保持成立。返回实扣积分。
func (s *StoryboardService) charge(ctx context.Context, userID, canvasID uint64, credits int) (int, error) {
	if credits <= 0 {
		return 0, nil
	}
	charged := 0
	err := s.repo.WithTx(ctx, func(tx repository.StoryboardTx) error {
		credit, err := tx.LockCredit(ctx, userID)
		if errors.Is(err, repository.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		charged = min(credits, max(credit.Balance-credit.Frozen, 0))
		if charged == 0 {
			return nil
		}
		for _, typ := range []string{model.LedgerFreeze, model.LedgerSettle} {
			if _, err := tx.InsertLedger(ctx, &model.CreditLedger{UserID: userID, CanvasID: &canvasID, Type: typ, Amount: charged, Note: "分镜表拆分镜"}); err != nil {
				return err
			}
		}
		return tx.AddCredit(ctx, userID, -charged, 0)
	})
	return charged, err
}

// splitError 把环节运行的错误换成业务错误：上游报错带出原文，两次都不合格、超时各有说法。
func splitError(err error) error {
	switch {
	case errors.Is(err, stepkit.ErrOutputInvalid):
		return errcode.ErrStoryboardSplitFailed
	case errors.Is(err, context.DeadlineExceeded):
		return errcode.ErrStoryboardModelCall.WithMsg("文本模型响应超时，请稍后重试")
	case errors.Is(err, stepkit.ErrCallFailed):
		if up := upstreamText(err); up != "" {
			return errcode.ErrStoryboardModelCall.WithMsg("文本模型调用失败：" + up)
		}
		return errcode.ErrStoryboardModelCall
	}
	return err
}

// toModelShots 把领域镜头换成接口返回的结构。
func toModelShots(in []storyboard.Shot) []model.StoryboardShot {
	out := make([]model.StoryboardShot, len(in))
	for i, s := range in {
		out[i] = model.StoryboardShot{Scene: s.Scene, Shot: s.Shot, Camera: s.Camera, Action: s.Action, Dialogue: s.Dialogue, Duration: s.Duration}
	}
	return out
}
