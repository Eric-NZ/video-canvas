package service_test

import (
	"context"
	"encoding/json"
	"testing"

	"video-canvas/internal/agent/canvasgraph"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/pkg/ws"
	"video-canvas/internal/repository"
	"video-canvas/internal/service"
	"video-canvas/internal/service/dramasegmentfake"
)

// boardCanvasRepo 是画布 9（属于用户 1 的短剧）的内存仓储：CAS 写入，记下每次写入。
type boardCanvasRepo struct {
	repository.DramaCanvasTx
	payload  []byte
	revision uint64
	writes   int
	// conflictOnce 第一次写入时报版本冲突（模拟用户同时保存）
	conflictOnce bool
}

func (c *boardCanvasRepo) GetCanvas(_ context.Context, userID, canvasID uint64) (*model.CanvasProject, error) {
	if userID != 1 || canvasID != 9 {
		return nil, repository.ErrNotFound
	}
	return &model.CanvasProject{PayloadJSON: c.payload, Revision: c.revision}, nil
}

func (c *boardCanvasRepo) WithTx(_ context.Context, fn func(repository.DramaCanvasTx) error) error {
	return fn(c)
}

func (c *boardCanvasRepo) IsDramaCanvas(_ context.Context, userID, canvasID uint64) (bool, error) {
	return userID == 1 && canvasID == 9, nil
}

func (c *boardCanvasRepo) CheckCanvasRevision(_ context.Context, _, _, revision uint64) error {
	if c.conflictOnce {
		c.conflictOnce = false
		c.revision++
		return repository.ErrRevisionConflict
	}
	if revision != c.revision {
		return repository.ErrRevisionConflict
	}
	return nil
}

func (c *boardCanvasRepo) UpdateCanvas(_ context.Context, _, _, revision uint64, payload []byte) error {
	if revision != c.revision {
		return repository.ErrRevisionConflict
	}
	c.payload, c.revision, c.writes = payload, c.revision+1, c.writes+1
	return nil
}

func (c *boardCanvasRepo) graph(t *testing.T) *canvasgraph.Graph {
	t.Helper()
	g, err := canvasgraph.Parse(c.payload)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

// boardSetup 一集已锁定、有一个片段的短剧，画布上有一个场景资产。
func boardSetup(t *testing.T) (*service.DramaSegmentService, *dramasegmentfake.Repo, *boardCanvasRepo, string) {
	t.Helper()
	r := dramasegmentfake.New()
	c := &boardCanvasRepo{revision: 3, payload: []byte(`{"nodes":[{"id":"n_kitchen","type":"canvas","position":{"x":0,"y":0},"data":{"kind":"image","drama":{"type":"scene","name":"厨房","episodes":[]}}}],"edges":[]}`)}
	s := service.NewDramaSegmentService(service.DramaSegmentDeps{Repo: r, Tasks: r, Assets: r, Broadcaster: r, Canvas: c})
	v, err := s.Create(context.Background(), 1, 7, 1, &model.CreateDramaSegmentReq{})
	if err != nil {
		t.Fatal(err)
	}
	return s, r, c, idcodec.Encode(uint64(v.ID))
}

func boardReq() *model.GenerateDramaBoardReq {
	return &model.GenerateDramaBoardReq{
		ModelID: "img-1", Input: map[string]any{"prompt": "生成一张 4 格分镜图", "images": []any{float64(5)}},
		Prompt: "生成一张 4 格分镜图 @[厨房](n_kitchen)", Params: map[string]any{"prompt": "生成一张 4 格分镜图", "aspect_ratio": "16:9"},
		Label: "故事板 · 第 1 集 · 01", SourceHash: "h1", Layout: "2x2", ShotCount: 3, Refs: []string{"n_kitchen"},
	}
}

func canvasPatches(msgs []ws.Message) int {
	n := 0
	for _, m := range msgs {
		if m.Type == "canvas.patch" {
			n++
		}
	}
	return n
}

func TestDramaBoardGenerateWritesNodeAndBindsTask(t *testing.T) {
	ctx := context.Background()
	s, r, c, segID := boardSetup(t)
	sid, _ := idcodec.Decode(segID)
	task, err := s.GenerateBoard(ctx, 1, sid, "k1", boardReq())
	if err != nil {
		t.Fatal(err)
	}
	// 任务：图片种类、挂在短剧画布的故事板节点上，输入原样交给生成服务
	if r.Created.Kind != model.KindImage || uint64(r.Created.CanvasID) != 9 || r.Created.ModelID != "img-1" || r.IdempotencyKey != "k1" || r.Created.Input["prompt"] != "生成一张 4 格分镜图" {
		t.Fatalf("任务请求不对：%+v", r.Created)
	}
	g := c.graph(t)
	n := canvasgraph.FindBoard(g, segID)
	if n == nil || n.ID() != r.Created.NodeID {
		t.Fatalf("任务应挂在新建的故事板节点上：%+v", r.Created)
	}
	d := n.Data()
	if d["taskId"] != "101" || d["status"] != "running" || d["model"] != "img-1" || d["label"] != "故事板 · 第 1 集 · 01" {
		t.Fatalf("节点数据不对：%v", d)
	}
	if len(g.Edges) != 1 || g.Edges[0].Source() != "n_kitchen" || c.writes != 1 || task.ID != 101 {
		t.Fatalf("连线或写入次数不对：edges=%v writes=%d", g.Edges, c.writes)
	}
	if canvasPatches(r.Messages) != 1 {
		t.Fatalf("应推一次 canvas.patch：%v", r.Messages)
	}

	// 再生成：沿用同一个节点
	if _, err := s.GenerateBoard(ctx, 1, sid, "k2", boardReq()); err != nil {
		t.Fatal(err)
	}
	if r.Created.NodeID != n.ID() || len(c.graph(t).Nodes) != 2 {
		t.Fatalf("应沿用已有节点：%s", r.Created.NodeID)
	}
}

func TestDramaBoardGenerateGuards(t *testing.T) {
	ctx := context.Background()
	s, r, c, segID := boardSetup(t)
	sid, _ := idcodec.Decode(segID)

	// 任务没建成：画布不动
	r.CreateError = &model.TaskItemError{Code: 40201, Message: "积分不足", Status: 402}
	_, err := s.GenerateBoard(ctx, 1, sid, "", boardReq())
	segmentCode(t, err, 40201)
	if c.writes != 0 {
		t.Fatal("任务没建成不应写画布")
	}
	r.CreateError = nil

	// 别人的片段
	_, err = s.GenerateBoard(ctx, 2, sid, "", boardReq())
	segmentCode(t, err, 67009)

	// 写画布时撞上用户同时保存：重读重放，不丢
	c.conflictOnce = true
	if _, err := s.GenerateBoard(ctx, 1, sid, "", boardReq()); err != nil {
		t.Fatal(err)
	}
	if canvasgraph.FindBoard(c.graph(t), segID) == nil {
		t.Fatal("冲突重试后应写入")
	}

	// 没配画布仓储：不能生成
	plain := service.NewDramaSegmentService(service.DramaSegmentDeps{Repo: r, Tasks: r, Assets: r, Broadcaster: r})
	if _, err := plain.GenerateBoard(ctx, 1, sid, "", boardReq()); err == nil {
		t.Fatal("没有画布仓储应报错")
	}
}

func TestDramaBoardTaskBackfill(t *testing.T) {
	ctx := context.Background()
	s, r, c, segID := boardSetup(t)
	sid, _ := idcodec.Decode(segID)
	if _, err := s.GenerateBoard(ctx, 1, sid, "", boardReq()); err != nil {
		t.Fatal(err)
	}
	nodeID := r.Created.NodeID
	canvas := uint64(9)
	output, _ := json.Marshal([]model.TaskOutput{{AssetID: 31, URL: "https://cdn/31.png", MediaType: "image"}})
	task := &model.GenerationTask{ID: 101, UserID: 1, CanvasProjectID: &canvas, NodeID: nodeID, Kind: model.KindImage, Status: model.TaskRunning}

	// 还没结束：不写
	writes := c.writes
	if err := s.OnTaskChanged(ctx, task); err != nil || c.writes != writes {
		t.Fatalf("未结束不该写：%v", err)
	}
	// 成功：结果写回节点并推 patch
	task.Status, task.OutputJSON = model.TaskSucceeded, output
	patches := canvasPatches(r.Messages)
	if err := s.OnTaskChanged(ctx, task); err != nil {
		t.Fatal(err)
	}
	d := c.graph(t).Node(nodeID).Data()
	if d["status"] != "done" || d["src"] != "https://cdn/31.png" || d["assetId"] != "31" {
		t.Fatalf("应写回结果：%v", d)
	}
	if canvasPatches(r.Messages) != patches+1 {
		t.Fatal("写回后应推 canvas.patch")
	}
	// 重复通知：不再写
	writes = c.writes
	if err := s.OnTaskChanged(ctx, task); err != nil || c.writes != writes {
		t.Fatalf("重复通知不该再写：%v", err)
	}
	// 别的画布、不是图片、测试任务、普通图片节点的任务：都不碰
	other := uint64(8)
	for _, tk := range []*model.GenerationTask{
		{ID: 102, UserID: 1, CanvasProjectID: &other, NodeID: nodeID, Kind: model.KindImage, Status: model.TaskSucceeded, OutputJSON: output},
		{ID: 101, UserID: 1, CanvasProjectID: &canvas, NodeID: nodeID, Kind: model.KindVideo, Status: model.TaskSucceeded, OutputJSON: output},
		{ID: 103, UserID: 1, CanvasProjectID: &canvas, NodeID: "n_kitchen", Kind: model.KindImage, Status: model.TaskSucceeded, OutputJSON: output},
		{ID: 101, UserID: 1, CanvasProjectID: &canvas, NodeID: nodeID, Kind: model.KindImage, Status: model.TaskFailed, IsTest: true},
	} {
		if err := s.OnTaskChanged(ctx, tk); err != nil || c.writes != writes {
			t.Fatalf("不该写：%+v err=%v", tk, err)
		}
	}
}
