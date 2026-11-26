package handler_test

import (
	"testing"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
)

func TestDramaTimelineHandler_Contracts(t *testing.T) {
	r, repo := segmentHTTP()
	chosen, canvas := uint64(101), uint64(9)
	repo.Rows = []model.DramaSegment{{BaseModel: model.BaseModel{ID: 1}, UserID: 1, EpisodeID: 10, Seq: 0, Seconds: 15, ChosenTaskID: &chosen, Revision: 1}}
	repo.Tasks = []model.GenerationTask{{ID: 101, UserID: 1, CanvasProjectID: &canvas, NodeID: "seg:" + idcodec.Encode(1), Kind: model.KindVideo, Status: model.TaskSucceeded, OutputJSON: []byte(`[{"asset_id":501,"media_type":"video"}]`)}}
	repo.Library = []model.Asset{{ID: 501, UserID: 1, Kind: "video", DurationMs: 15000}}
	path := "/dramas/" + idcodec.Encode(7) + "/episodes/1/timeline"
	clip := `{"id":"a","kind":"segment","segment_id":"` + idcodec.Encode(1) + `","task_id":"` + idcodec.Encode(101) + `","in_ms":1000,"out_ms":9000}`
	for _, tc := range []struct {
		name, method, body string
		status, code       int
	}{
		{"读取默认时间线", "GET", "", 200, 0},
		{"第一次保存", "PUT", `{"revision":0,"clips":[` + clip + `]}`, 200, 0},
		{"旧版本冲突", "PUT", `{"revision":0,"clips":[` + clip + `]}`, 409, errcode.ErrDramaTimelineConflict.Code},
		{"版本为负", "PUT", `{"revision":-1,"clips":[]}`, 400, 10001},
		{"ID 不是编码串", "PUT", `{"revision":1,"clips":[{"id":"a","kind":"segment","segment_id":1}]}`, 400, 10001},
		{"内容不合法", "PUT", `{"revision":1,"clips":[{"id":"a","kind":"segment","segment_id":"` + idcodec.Encode(1) + `","task_id":"` + idcodec.Encode(101) + `","in_ms":0,"out_ms":100}]}`, 400, errcode.ErrDramaTimelineInvalid.Code},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, body := characterCall(t, r, tc.method, path, tc.body)
			if status != tc.status || responseCode(t, body) != tc.code {
				t.Fatalf("status=%d body=%+v", status, body)
			}
		})
	}
	_, body := characterCall(t, r, "GET", path, "")
	data := responseData(t, body)
	if data["revision"].(float64) != 1 || len(data["clips"].([]any)) != 1 {
		t.Fatalf("保存后读取 %+v", data)
	}
}
