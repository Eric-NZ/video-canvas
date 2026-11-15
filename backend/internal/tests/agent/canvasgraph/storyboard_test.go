package canvasgraph_test

import (
	"strings"
	"testing"

	"video-canvas/internal/agent/canvasgraph"
)

// storyboardPayload 是一张带分镜表节点的画布：剧本连着分镜表，分镜表里有两个镜头。
const storyboardPayload = `{
  "nodes": [
    {"id":"n_txt","type":"canvas","position":{"x":0,"y":0},
     "data":{"kind":"script","label":"剧本","text":"雨夜，林晚推门进屋。"}},
    {"id":"n_sb","type":"canvas","position":{"x":700,"y":0},
     "data":{"kind":"storyboard","label":"分镜表","storyboard":{"shots":[
       {"id":"a","scene":"推门进屋","shot":"全景","camera":"推","action":"","dialogue":"","duration":4.5},
       {"id":"b","scene":"看向窗外","shot":"特写","camera":"固定","action":"","dialogue":"OS：又是雨天。","duration":2}
     ]}}}
  ],
  "edges": [{"id":"e_1","source":"n_txt","target":"n_sb"}]
}`

// TestStoryboardNodeSurvivesRoundTrip 分镜表节点读得进来、写回去时镜头原样保留。
func TestStoryboardNodeSurvivesRoundTrip(t *testing.T) {
	g := mustParse(t, storyboardPayload)
	res := mustApply(t, g, `[{"op":"create_node","tempId":"a","kind":"script"}]`)
	out, err := res.Graph.Marshal()
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	for _, want := range []string{`"scene":"推门进屋"`, `"dialogue":"OS：又是雨天。"`, `"duration":4.5`} {
		if !strings.Contains(string(out), want) {
			t.Errorf("分镜表的镜头丢了 %s：%s", want, out)
		}
	}
}

// TestAgentCannotCreateStoryboard 迭代 1 Agent 不能新建分镜表节点。
func TestAgentCannotCreateStoryboard(t *testing.T) {
	_, err := canvasgraph.Apply(mustParse(t, `{}`), mustOps(t, `[{"op":"create_node","tempId":"a","kind":"storyboard"}]`), opts())
	if err == nil || !strings.Contains(err.Error(), "分镜表") {
		t.Fatalf("应拒绝新建分镜表，err=%v", err)
	}
}

// TestAgentCannotUpdateStoryboard 迭代 1 Agent 不能改分镜表节点。
func TestAgentCannotUpdateStoryboard(t *testing.T) {
	_, err := canvasgraph.Apply(mustParse(t, storyboardPayload), mustOps(t, `[{"op":"update_node","id":"n_sb","label":"新名字"}]`), opts())
	if err == nil || !strings.Contains(err.Error(), "分镜表") {
		t.Fatalf("应拒绝修改分镜表，err=%v", err)
	}
}

// TestStoryboardCannotBeLinkedByAgent 迭代 1 Agent 不给分镜表连线，进出都不行。
func TestStoryboardCannotBeLinkedByAgent(t *testing.T) {
	g := mustParse(t, storyboardPayload)
	for _, ops := range []string{
		`[{"op":"create_node","tempId":"s","kind":"script"},{"op":"connect","source":"s","target":"n_sb"}]`,
		`[{"op":"create_node","tempId":"i","kind":"image"},{"op":"connect","source":"n_sb","target":"i"}]`,
	} {
		if _, err := canvasgraph.Apply(g, mustOps(t, ops), opts()); err == nil || !strings.Contains(err.Error(), "分镜表") {
			t.Errorf("应拒绝连线：%s，err=%v", ops, err)
		}
	}
}
