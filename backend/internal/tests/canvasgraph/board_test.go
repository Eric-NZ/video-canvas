package canvasgraph_test

import (
	"encoding/json"
	"testing"

	"video-canvas/internal/agent/canvasgraph"
)

// boardGraph 一张有两个资产节点（一个带 measured 宽度）的短剧画布；extra 是额外的节点 JSON。
func boardGraph(t *testing.T, extra string) *canvasgraph.Graph {
	t.Helper()
	nodes := `{"id":"n_kitchen","type":"canvas","position":{"x":0,"y":100},"measured":{"width":300},"data":{"kind":"image","drama":{"type":"scene","name":"厨房","episodes":[]}}},
		{"id":"n_runtu","type":"canvas","position":{"x":500,"y":40},"width":200,"data":{"kind":"character","drama":{"type":"character","name":"闰土","episodes":[]}}}`
	if extra != "" {
		nodes += "," + extra
	}
	g, err := canvasgraph.Parse([]byte(`{"nodes":[` + nodes + `],"edges":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func boardSpec() canvasgraph.BoardSpec {
	return canvasgraph.BoardSpec{
		SegmentID: "s1", EpisodeNo: 2, Seq: 1, Label: "故事板 · 第 2 集 · 02",
		Prompt: "生成一张 4 格分镜图", Params: map[string]any{"prompt": "生成一张 4 格分镜图", "aspect_ratio": "16:9"},
		Model: "img-1", Board: map[string]any{"segmentId": "s1", "sourceHash": "h1", "layout": "2x2", "shotCount": float64(3)},
		Refs: []string{"n_kitchen", "n_gone", "n_runtu"}, NewID: "b_new",
	}
}

func jsonOf(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestUpsertBoardCreatesNodeEdgesAndBindsTask(t *testing.T) {
	g := boardGraph(t, "")
	res, id := canvasgraph.UpsertBoard(g, boardSpec(), "88")
	if id != "b_new" || g.Node("b_new") != nil {
		t.Fatalf("应新建节点且不改入参：id=%s", id)
	}
	n := res.Graph.Node(id)
	d := n.Data()
	if d["kind"] != "image" || d["label"] != "故事板 · 第 2 集 · 02" || d["model"] != "img-1" || d["prompt"] != "生成一张 4 格分镜图" {
		t.Fatalf("节点数据不对：%s", jsonOf(t, d))
	}
	if d["taskId"] != "88" || d["status"] != "running" || d["src"] != nil {
		t.Fatalf("应绑定任务并置为生成中：%s", jsonOf(t, d))
	}
	if got := jsonOf(t, d["drama"]); got != `{"board":{"layout":"2x2","segmentId":"s1","shotCount":3,"sourceHash":"h1"},"episodes":[2]}` {
		t.Fatalf("drama 标记不对：%s", got)
	}
	// 位置：最右的非故事板节点右边（500+200）再隔 400，第 2 段往右挪一格（576+48），第 2 集往下一行（324+96）
	if p := n.Position(); p.X != 700+400+624 || p.Y != 40+420 {
		t.Fatalf("位置不对：%+v", p)
	}
	// 画布上不存在的资产不连；连线和前端画布里的样式一致
	if len(res.Graph.Edges) != 2 || res.Graph.Edges[0].Source() != "n_kitchen" || res.Graph.Edges[1].Source() != "n_runtu" {
		t.Fatalf("连线不对：%s", jsonOf(t, res.Graph.Edges))
	}
	if e := res.Graph.Edges[0]; e.ID() != "xy-edge__n_kitchen-b_new" || e["type"] != "animatedSvgEdge" {
		t.Fatalf("连线格式不对：%s", jsonOf(t, e))
	}
	if len(res.Changes) == 0 {
		t.Fatal("应有差异，前端靠它合并进已打开的编辑器")
	}
}

func TestUpsertBoardRegeneratesExistingNode(t *testing.T) {
	old := `{"id":"b_old","type":"canvas","position":{"x":9,"y":9},"data":{"kind":"image","label":"故事板 · 旧","model":"user-picked",
		"params":{"prompt":"旧","resolution":"2K"},"src":"https://cdn/1.png","assetId":"1","mediaType":"image","taskId":"5","status":"done",
		"drama":{"episodes":[2],"board":{"segmentId":"s1","sourceHash":"h0","layout":"2x2","shotCount":2}}}}`
	g := boardGraph(t, old)
	g.Edges = append(g.Edges, canvasgraph.Edge{"id": "e1", "source": "n_kitchen", "target": "b_old"})
	res, id := canvasgraph.UpsertBoard(g, boardSpec(), "89")
	if id != "b_old" || len(res.Graph.Nodes) != 3 {
		t.Fatalf("应改已有节点，不新建：id=%s", id)
	}
	n := res.Graph.Node(id)
	d := n.Data()
	if p := n.Position(); p.X != 9 || p.Y != 9 || d["label"] != "故事板 · 旧" {
		t.Fatal("位置和标题保持不变")
	}
	// 用项目设置里的模型；参数合并：新的覆盖同名，节点上另调过的保留
	if d["model"] != "img-1" || jsonOf(t, d["params"]) != `{"aspect_ratio":"16:9","prompt":"生成一张 4 格分镜图","resolution":"2K"}` {
		t.Fatalf("模型或参数不对：%s", jsonOf(t, d))
	}
	// 旧结果落进历史，当前结果清空
	if d["src"] != nil || d["assetId"] != nil || d["taskId"] != "89" || d["status"] != "running" {
		t.Fatalf("应清掉当前结果并绑定新任务：%s", jsonOf(t, d))
	}
	if got := jsonOf(t, d["outputs"]); got != `[{"assetId":"1","createdAt":0,"id":"1","mediaType":"image","model":"user-picked","src":"https://cdn/1.png","taskId":"5"}]` {
		t.Fatalf("旧结果应进历史：%s", got)
	}
	// 已有的连线不重复
	if len(res.Graph.Edges) != 2 {
		t.Fatalf("连线不应重复：%s", jsonOf(t, res.Graph.Edges))
	}
}

func TestBackfillBoard(t *testing.T) {
	running := func(t *testing.T) (*canvasgraph.Graph, string) {
		res, id := canvasgraph.UpsertBoard(boardGraph(t, ""), boardSpec(), "88")
		return res.Graph, id
	}
	ok := canvasgraph.BoardOutcome{TaskID: "88", Status: "succeeded", Outputs: []canvasgraph.BoardOutput{{AssetID: "31", URL: "https://cdn/31.png", MediaType: "image"}}, Now: 1700}

	t.Run("成功：追加新版本并设为当前，状态 done", func(t *testing.T) {
		g, id := running(t)
		res := canvasgraph.BackfillBoard(g, id, ok)
		if res == nil {
			t.Fatal("应写回")
		}
		d := res.Graph.Node(id).Data()
		if d["status"] != "done" || d["src"] != "https://cdn/31.png" || d["assetId"] != "31" || d["mediaType"] != "image" || d["activeOutputId"] != "31" || d["error"] != nil {
			t.Fatalf("%s", jsonOf(t, d))
		}
		if got := jsonOf(t, d["outputs"]); got != `[{"assetId":"31","createdAt":1700,"id":"31","mediaType":"image","model":"img-1","src":"https://cdn/31.png","taskId":"88"}]` {
			t.Fatalf("历史版本不对：%s", got)
		}
		// 再回写一次（推送重复）不改
		if canvasgraph.BackfillBoard(res.Graph, id, ok) != nil {
			t.Fatal("重复回写应幂等")
		}
	})

	t.Run("taskId 对不上、不是故事板、节点不在：都不改", func(t *testing.T) {
		g, id := running(t)
		other := ok
		other.TaskID = "99"
		if canvasgraph.BackfillBoard(g, id, other) != nil || canvasgraph.BackfillBoard(g, "n_kitchen", ok) != nil || canvasgraph.BackfillBoard(g, "nope", ok) != nil {
			t.Fatal("不该写")
		}
	})

	t.Run("失败：写原因和任务编号；没有产物的成功也按失败", func(t *testing.T) {
		g, id := running(t)
		res := canvasgraph.BackfillBoard(g, id, canvasgraph.BoardOutcome{TaskID: "88", Status: "failed", Error: "内容违规", TaskRef: "T-1"})
		d := res.Graph.Node(id).Data()
		if d["status"] != "error" || d["error"] != "内容违规" || d["errorTaskRef"] != "T-1" || d["taskId"] != "88" {
			t.Fatalf("%s", jsonOf(t, d))
		}
		res = canvasgraph.BackfillBoard(g, id, canvasgraph.BoardOutcome{TaskID: "88", Status: "expired"})
		if res.Graph.Node(id).Data()["error"] != "生成超时" {
			t.Fatal("超时的默认原因")
		}
		res = canvasgraph.BackfillBoard(g, id, canvasgraph.BoardOutcome{TaskID: "88", Status: "succeeded"})
		if d := res.Graph.Node(id).Data(); d["status"] != "error" || d["error"] != "生成结果为空，请重试" {
			t.Fatalf("%s", jsonOf(t, d))
		}
	})

	t.Run("取消：有历史退回当前版本，没有回到 idle，都清掉 taskId", func(t *testing.T) {
		g, id := running(t)
		res := canvasgraph.BackfillBoard(g, id, canvasgraph.BoardOutcome{TaskID: "88", Status: "canceled"})
		if d := res.Graph.Node(id).Data(); d["status"] != "idle" || d["taskId"] != nil {
			t.Fatalf("%s", jsonOf(t, d))
		}
		done := canvasgraph.BackfillBoard(g, id, ok).Graph
		again, _ := canvasgraph.UpsertBoard(done, boardSpec(), "90")
		res = canvasgraph.BackfillBoard(again.Graph, id, canvasgraph.BoardOutcome{TaskID: "90", Status: "canceled"})
		if d := res.Graph.Node(id).Data(); d["status"] != "done" || d["src"] != "https://cdn/31.png" || d["taskId"] != nil {
			t.Fatalf("%s", jsonOf(t, d))
		}
	})
}
