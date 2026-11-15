package canvasdoc_test

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"video-canvas/internal/canvasdoc"
)

// storyboardShots 是分镜表节点里的镜头，导出、导入后要逐字不变。
const storyboardShots = `[
  {"id":"a","scene":"推门进屋","shot":"全景","camera":"推","action":"从门口走到窗边","dialogue":"","duration":4.5},
  {"id":"b","scene":"看向窗外","shot":"特写","camera":"固定","action":"","dialogue":"OS：又是雨天。","duration":2}
]`

// storyboardPayload 是一张剧本连分镜表的画布，没有素材。
const storyboardPayload = `{
  "nodes":[
    {"id":"n1","type":"canvas","position":{"x":0,"y":0},"data":{"kind":"script","label":"剧本","text":"雨夜。"}},
    {"id":"n2","type":"canvas","position":{"x":700,"y":0},"data":{"kind":"storyboard","label":"分镜表","storyboard":{"shots":` + storyboardShots + `}}}
  ],
  "edges":[{"id":"e1","source":"n1","target":"n2"}],
  "viewport":{"x":0,"y":0,"zoom":1}
}`

// TestStoryboard_ExportRestoreRoundTrip 分镜表的镜头、节点 id 和剧本连线在导出再导入后都不丢。
func TestStoryboard_ExportRestoreRoundTrip(t *testing.T) {
	doc, _ := mustBuild(t, canvasdoc.ExportInput{
		Title:      "分镜",
		Payload:    []byte(storyboardPayload),
		Assets:     map[string]canvasdoc.AssetEntry{},
		AppVersion: "0.6.12",
		Now:        time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC),
	})
	encoded, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	p, _, rep := mustRestore(t, canvasdoc.RestoreInput{Doc: mustParseDoc(t, string(encoded)), Assets: map[string]canvasdoc.RestoredAsset{}})
	if len(rep.MissingAssets) != 0 || rep.EdgesDropped != 0 {
		t.Errorf("报告应为空，实际 %+v", rep)
	}

	data := restoredData(t, p, "n2")
	if data["kind"] != "storyboard" || data["label"] != "分镜表" {
		t.Errorf("分镜表节点的种类或标题变了：%v", data)
	}
	got, _ := json.Marshal(data["storyboard"])
	var want, have any
	_ = json.Unmarshal([]byte(`{"shots":`+storyboardShots+`}`), &want)
	_ = json.Unmarshal(got, &have)
	if !reflect.DeepEqual(have, want) {
		t.Errorf("镜头变了：\n得到 %s", got)
	}
	if len(p.Edges) != 1 || p.Edges[0]["source"] != "n1" || p.Edges[0]["target"] != "n2" {
		t.Errorf("剧本到分镜表的连线丢了：%v", p.Edges)
	}
}
