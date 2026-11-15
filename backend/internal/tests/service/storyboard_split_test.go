package service_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"video-canvas/internal/llmgateway"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/provider"
	"video-canvas/internal/provider/modelcfg"
	"video-canvas/internal/repository"
	"video-canvas/internal/service"
	"video-canvas/internal/service/stepfake"
	"video-canvas/internal/stepkit"
)

// sbRepo 是拆分镜用的内存仓储：积分原语复用 stepfake.Repo，画布归属按 owned 判断。
type sbRepo struct {
	*stepfake.Repo
	owned map[uint64]uint64 // 画布 id → 用户 id
}

func (r *sbRepo) WithTx(_ context.Context, fn func(repository.StoryboardTx) error) error {
	return fn(r.Repo)
}

func (r *sbRepo) CanvasOwned(_ context.Context, userID, canvasID uint64) error {
	if r.owned[canvasID] != userID {
		return repository.ErrNotFound
	}
	return nil
}

const (
	sbUser   = uint64(7)
	sbCanvas = uint64(70)
)

const sbValid = `{"shots":[
  {"scene":"雨夜便利店外景","shot":"远景","camera":"固定","action":"","dialogue":"","duration":4},
  {"scene":"林晚推门进来","shot":"中景","camera":"跟","action":"走到收银台","dialogue":"林晚：还有关东煮吗？","duration":75}
]}`

// sbEnv 组装拆分镜服务：一个 Agent 模型（按次 5 积分）、账户 100 积分。
type sbEnv struct {
	svc    *service.StoryboardService
	repo   *sbRepo
	caller *stepfake.Caller
	models *stepfake.Models
}

func newSBEnv(replies ...stepfake.Reply) *sbEnv {
	repo := &sbRepo{Repo: stepfake.NewRepo(), owned: map[uint64]uint64{sbCanvas: sbUser}}
	repo.Credits[sbUser] = &model.UserCredit{UserID: sbUser, Balance: 100}
	models := stepfake.NewModels()
	models.Snapshots = map[string]*provider.Snapshot{"agent-a": stepfake.TextModel("agent-a", false, false, 5)}
	caller := &stepfake.Caller{Replies: replies}
	svc := service.NewStoryboardService(service.StoryboardDeps{Repo: repo, Models: models, Caller: caller, Credits: stepfake.Policy{Initial: 100}})
	return &sbEnv{svc: svc, repo: repo, caller: caller, models: models}
}

// sameCode 判断是不是这个业务错误码（WithMsg 换了文案也算）。
func sameCode(err error, want *errcode.Error) bool {
	var e *errcode.Error
	return errors.As(err, &e) && e.Code == want.Code
}

func sbReq(script string) *model.StoryboardSplitReq {
	return &model.StoryboardSplitReq{NodeID: "n_sb", Script: script, Model: "agent-a"}
}

// TestStoryboardSplit_Succeeds 拆出镜头、时长截断，按实际用量扣费并写一对关联画布的流水。
func TestStoryboardSplit_Succeeds(t *testing.T) {
	e := newSBEnv(stepfake.Reply{Text: sbValid, Usage: llmgateway.Usage{InputTokens: 10, OutputTokens: 10}})
	resp, err := e.svc.Split(context.Background(), sbUser, sbCanvas, sbReq("雨夜，林晚推门进便利店。"))
	if err != nil {
		t.Fatalf("Split: %v", err)
	}
	if len(resp.Shots) != 2 || resp.Shots[1].Duration != 60 || resp.Shots[1].Camera != "跟" {
		t.Fatalf("镜头不对：%+v", resp.Shots)
	}
	if resp.Credits != 5 || resp.Model != "agent-a" {
		t.Fatalf("应扣 5 积分、用 agent-a：%+v", resp)
	}
	if got := e.repo.Credits[sbUser].Balance; got != 95 {
		t.Errorf("余额应剩 95，实际 %d", got)
	}
	if len(e.repo.Ledger) != 2 {
		t.Fatalf("应有冻结 + 结算两条流水：%+v", e.repo.Ledger)
	}
	for _, l := range e.repo.Ledger {
		if l.CanvasID == nil || *l.CanvasID != sbCanvas || l.Amount != 5 || !strings.Contains(l.Note, "拆分镜") {
			t.Errorf("流水不对：%+v", l)
		}
	}
}

// TestStoryboardSplit_InvalidTwiceChargesNothing 两次输出都不合格：报拆分镜失败，不扣费。
func TestStoryboardSplit_InvalidTwiceChargesNothing(t *testing.T) {
	bad := stepfake.Reply{Text: `{"shots":[{"scene":"x","shot":"超大特写","camera":"推","action":"","dialogue":"","duration":3}]}`}
	e := newSBEnv(bad, bad)
	_, err := e.svc.Split(context.Background(), sbUser, sbCanvas, sbReq("剧本"))
	if !errors.Is(err, errcode.ErrStoryboardSplitFailed) {
		t.Fatalf("应报拆分镜失败，实际 %v", err)
	}
	if e.repo.Credits[sbUser].Balance != 100 || len(e.repo.Ledger) != 0 {
		t.Error("失败不扣费")
	}
}

// TestStoryboardSplit_ModelCallFailure 上游报错：带出上游原文，不扣费。
func TestStoryboardSplit_ModelCallFailure(t *testing.T) {
	e := newSBEnv(stepfake.Reply{Err: &llmgateway.UpstreamError{Status: 429, Message: "rate limited"}})
	_, err := e.svc.Split(context.Background(), sbUser, sbCanvas, sbReq("剧本"))
	if !sameCode(err, errcode.ErrStoryboardModelCall) || !strings.Contains(err.Error(), "rate limited") {
		t.Fatalf("应报模型调用失败并带出原因，实际 %v", err)
	}
	if len(e.repo.Ledger) != 0 {
		t.Error("失败不扣费")
	}
}

// TestStoryboardSplit_RejectsBeforeCallingModel 空剧本、超长剧本、别人的画布、积分不够、没有模型：都不调模型。
func TestStoryboardSplit_RejectsBeforeCallingModel(t *testing.T) {
	cases := []struct {
		name  string
		setup func(e *sbEnv) (canvas uint64, req *model.StoryboardSplitReq)
		want  error
	}{
		{"空剧本", func(*sbEnv) (uint64, *model.StoryboardSplitReq) { return sbCanvas, sbReq("  \n ") }, errcode.ErrStoryboardScriptEmpty},
		{"超长剧本", func(*sbEnv) (uint64, *model.StoryboardSplitReq) {
			return sbCanvas, sbReq(strings.Repeat("字", 20001))
		}, errcode.ErrStoryboardScriptTooLong},
		{"别人的画布", func(*sbEnv) (uint64, *model.StoryboardSplitReq) { return 99, sbReq("剧本") }, errcode.ErrCanvasNotFound},
		{"积分不够", func(e *sbEnv) (uint64, *model.StoryboardSplitReq) {
			e.repo.Credits[sbUser].Balance = 1
			return sbCanvas, sbReq("剧本")
		}, errcode.ErrInsufficientCredits},
		{"没有模型", func(e *sbEnv) (uint64, *model.StoryboardSplitReq) {
			delete(e.models.Snapshots, "agent-a")
			return sbCanvas, sbReq("剧本")
		}, errcode.ErrStoryboardNoModel},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := newSBEnv(stepfake.Reply{Text: sbValid})
			canvas, req := c.setup(e)
			_, err := e.svc.Split(context.Background(), sbUser, canvas, req)
			if !errors.Is(err, c.want) {
				t.Fatalf("应报 %v，实际 %v", c.want, err)
			}
			if e.caller.Calls != 0 {
				t.Error("不该调模型")
			}
		})
	}
}

// TestStoryboardSplit_FallsBackToFirstModel 选的模型下架了：用第一个可用的 Agent 模型。
func TestStoryboardSplit_FallsBackToFirstModel(t *testing.T) {
	e := newSBEnv(stepfake.Reply{Text: sbValid})
	req := sbReq("剧本")
	req.Model = "gone"
	resp, err := e.svc.Split(context.Background(), sbUser, sbCanvas, req)
	if err != nil || resp.Model != "agent-a" {
		t.Fatalf("应回落到 agent-a：%+v %v", resp, err)
	}
}

// slowCaller 第一次调用卡住，直到 release 关闭。
type slowCaller struct {
	stepfake.Caller
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (c *slowCaller) Complete(ctx context.Context, s *provider.Snapshot, m []llmgateway.Message) (*llmgateway.Result, error) {
	c.once.Do(func() { close(c.started) })
	<-c.release
	return c.Caller.Complete(ctx, s, m)
}

// TestStoryboardSplit_BusyWhileRunning 同一张分镜表拆分镜进行中，再点一次直接报正在拆分镜。
func TestStoryboardSplit_BusyWhileRunning(t *testing.T) {
	e := newSBEnv()
	slow := &slowCaller{Caller: stepfake.Caller{Replies: []stepfake.Reply{{Text: sbValid}}}, started: make(chan struct{}), release: make(chan struct{})}
	svc := service.NewStoryboardService(service.StoryboardDeps{Repo: e.repo, Models: e.models, Caller: slow, Credits: stepfake.Policy{Initial: 100}})
	done := make(chan error, 1)
	go func() {
		_, err := svc.Split(context.Background(), sbUser, sbCanvas, sbReq("剧本"))
		done <- err
	}()
	select {
	case <-slow.started:
	case <-time.After(3 * time.Second):
		t.Fatal("第一次拆分镜没开始")
	}
	if _, err := svc.Split(context.Background(), sbUser, sbCanvas, sbReq("剧本")); !errors.Is(err, errcode.ErrStoryboardSplitBusy) {
		t.Fatalf("应报正在拆分镜，实际 %v", err)
	}
	close(slow.release)
	if err := <-done; err != nil {
		t.Fatalf("第一次应成功：%v", err)
	}
}

// ctxCaller 阻塞到 ctx 结束，模拟一个一直不出字的模型；记下它拿到的截止时间。
type ctxCaller struct {
	deadline atomic.Pointer[time.Time]
}

func (c *ctxCaller) Complete(ctx context.Context, _ *provider.Snapshot, _ []llmgateway.Message) (*llmgateway.Result, error) {
	if d, ok := ctx.Deadline(); ok {
		c.deadline.Store(&d)
	}
	<-ctx.Done()
	return nil, ctx.Err()
}

// splitEnvWithCaller 用给定的调用方和模型截止时间搭一个服务，账户 100 积分。
func splitEnvWithCaller(deadline time.Duration, caller stepkit.Caller) (*service.StoryboardService, *sbRepo) {
	e := newSBEnv()
	e.models.Snapshots["agent-a"].Model.Deadline = modelcfg.Duration(deadline)
	svc := service.NewStoryboardService(service.StoryboardDeps{Repo: e.repo, Models: e.models, Caller: caller, Credits: stepfake.Policy{Initial: 100}})
	return svc, e.repo
}

// TestStoryboardSplit_TimesOutByModelDeadline 超时按后台给这个模型配的截止时间来：到点就按超时失败，不扣积分。
func TestStoryboardSplit_TimesOutByModelDeadline(t *testing.T) {
	c := &ctxCaller{}
	svc, repo := splitEnvWithCaller(150*time.Millisecond, c)
	start := time.Now()
	_, err := svc.Split(context.Background(), sbUser, sbCanvas, sbReq("剧本"))
	if !sameCode(err, errcode.ErrStoryboardModelCall) || !strings.Contains(err.Error(), "超时") {
		t.Fatalf("应报模型响应超时，实际 %v", err)
	}
	if took := time.Since(start); took > 3*time.Second {
		t.Errorf("应在配置的截止时间附近失败，实际等了 %v", took)
	}
	if repo.Credits[sbUser].Balance != 100 || len(repo.Ledger) != 0 {
		t.Error("超时失败不扣费")
	}
}

// TestStoryboardSplit_NoFixedCeiling 不再有写死的 50 秒上限：模型配了多长的截止时间，调用就能等多长。
func TestStoryboardSplit_NoFixedCeiling(t *testing.T) {
	c := &ctxCaller{}
	svc, _ := splitEnvWithCaller(10*time.Minute, c)
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	_, _ = svc.Split(ctx, sbUser, sbCanvas, sbReq("剧本"))
	d := c.deadline.Load()
	if d == nil {
		t.Fatal("调用方没有拿到截止时间")
	}
	// 外层 ctx 只给了 200ms，所以拿到的是它；关键是服务自己没有再套一层 50 秒的上限
	if time.Until(*d) > time.Second {
		t.Fatalf("截止时间应来自外层 ctx 或模型配置，不该多出别的上限：还剩 %v", time.Until(*d))
	}
	src, err := os.ReadFile("../../service/storyboard_split.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(src), "splitTimeout") || strings.Contains(string(src), "50 * time.Second") {
		t.Error("不该再写死拆分镜的超时时间")
	}
}

// TestStoryboardSplit_ZeroDeadlineMeansNoServiceLimit 模型没配截止时间（0）：服务不自己加限制，由网关的空闲超时兜底。
func TestStoryboardSplit_ZeroDeadlineMeansNoServiceLimit(t *testing.T) {
	c := &ctxCaller{}
	svc, _ := splitEnvWithCaller(0, c)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, _ = svc.Split(ctx, sbUser, sbCanvas, sbReq("剧本"))
	d := c.deadline.Load()
	if d == nil || time.Until(*d) > time.Second {
		t.Fatalf("截止时间只该来自外层 ctx")
	}
}
