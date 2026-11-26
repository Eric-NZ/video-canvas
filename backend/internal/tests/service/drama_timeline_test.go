package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/service/dramasegmentfake"
)

// timelineRepo 集10有两个片段：01 采用了结果 101（15 秒，另有 12 秒的 102），02 还没采用；用户另有导入图片 601，别人的图片 701。
func timelineRepo() *dramasegmentfake.Repo {
	r := dramasegmentfake.New()
	chosen, canvas := uint64(101), uint64(9)
	r.Rows = []model.DramaSegment{
		{BaseModel: model.BaseModel{ID: 1}, UserID: 1, EpisodeID: 10, Seq: 0, Seconds: 15, ChosenTaskID: &chosen, Revision: 1},
		{BaseModel: model.BaseModel{ID: 2}, UserID: 1, EpisodeID: 10, Seq: 1, Seconds: 15, Revision: 1},
	}
	task := func(id uint64, asset string) model.GenerationTask {
		return model.GenerationTask{ID: id, UserID: 1, CanvasProjectID: &canvas, NodeID: "seg:" + idcodec.Encode(1), Kind: model.KindVideo, Status: model.TaskSucceeded, OutputJSON: []byte(`[{"asset_id":` + asset + `,"media_type":"video"}]`)}
	}
	r.Tasks = []model.GenerationTask{task(101, "501"), task(102, "502")}
	r.Library = []model.Asset{
		{ID: 501, UserID: 1, Kind: "video", DurationMs: 15000},
		{ID: 502, UserID: 1, Kind: "video", DurationMs: 12000},
		{ID: 601, UserID: 1, Kind: "image"},
		{ID: 701, UserID: 2, Kind: "image"},
	}
	return r
}

func segClip(id string, sid, task uint64, in, out int64) model.DramaTimelineClip {
	return model.DramaTimelineClip{ID: id, Kind: model.TimelineKindSegment, SegmentID: idcodec.ID(sid), TaskID: idcodec.ID(task), InMS: in, OutMS: out}
}

func imageClip(id string, asset uint64, out int64) model.DramaTimelineClip {
	return model.DramaTimelineClip{ID: id, Kind: model.TimelineKindAsset, AssetID: idcodec.ID(asset), Media: model.TimelineMediaImage, OutMS: out}
}

func TestDramaTimeline_DefaultWhenNeverSaved(t *testing.T) {
	s := segmentService(timelineRepo())
	v, err := s.Timeline(context.Background(), 1, 7, 1)
	if err != nil {
		t.Fatal(err)
	}
	if v.Revision != 0 || len(v.Changes) != 0 || len(v.InvalidClipIDs) != 0 || len(v.Clips) != 2 {
		t.Fatalf("默认时间线 %+v", v)
	}
	first, second := v.Clips[0], v.Clips[1]
	if uint64(first.SegmentID) != 1 || uint64(first.TaskID) != 101 || first.InMS != 0 || first.OutMS != 15000 {
		t.Fatalf("第一段 %+v", first)
	}
	if uint64(second.SegmentID) != 2 || second.TaskID != 0 || second.OutMS != 15000 {
		t.Fatalf("待采用占位 %+v", second)
	}
}

func TestDramaTimeline_SaveReconcileAndConflict(t *testing.T) {
	r := timelineRepo()
	s := segmentService(r)
	ctx := context.Background()
	req := &model.SaveDramaTimelineReq{
		Clips:             []model.DramaTimelineClip{segClip("a", 1, 101, 2000, 14000), imageClip("x", 601, 3000)},
		Muted:             true,
		RemovedSegmentIDs: []idcodec.ID{2},
		Imports:           []idcodec.ID{601, 701, 601},
	}
	// 1. 第一次保存：版本 0 → 1，片段版本自增让成片过期；已导入去掉别人的素材和重复项。
	v, err := s.SaveTimeline(ctx, 1, 7, 1, req)
	if err != nil {
		t.Fatal(err)
	}
	if v.Revision != 1 || r.SegmentVersion != 1 || !v.Muted || len(v.Clips) != 2 || len(v.Changes) != 0 {
		t.Fatalf("保存结果 %+v，片段版本 %d", v, r.SegmentVersion)
	}
	if len(v.Imports) != 1 || uint64(v.Imports[0]) != 601 || len(v.RemovedSegmentIDs) != 1 || len(v.Assets) != 1 {
		t.Fatalf("已导入或删除名单 %+v", v)
	}
	// 2. 旧版本再保存：冲突，不写入。
	_, err = s.SaveTimeline(ctx, 1, 7, 1, req)
	segmentCode(t, err, errcode.ErrDramaTimelineConflict.Code)
	if r.SegmentVersion != 1 {
		t.Fatal("冲突时不应改片段版本")
	}
	// 3. 片场换了采用：读的时候跟随，出点收回到新版本的 12 秒；删掉的片段 02 不加回来。
	other := uint64(102)
	r.Rows[0].ChosenTaskID = &other
	v, err = s.Timeline(ctx, 1, 7, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(v.Clips) != 2 || uint64(v.Clips[0].TaskID) != 102 || v.Clips[0].InMS != 2000 || v.Clips[0].OutMS != 12000 {
		t.Fatalf("对账后 %+v", v.Clips)
	}
	if len(v.Changes) != 1 || v.Changes[0].Kind != model.TimelineChangeSwapped || v.Changes[0].ClipID != "a" {
		t.Fatalf("变化 %+v", v.Changes)
	}
	// 4. 固定的版本被删（结果不再成功）：标成失效段。
	req.Revision = 1
	req.Clips = []model.DramaTimelineClip{segClip("a", 1, 101, 0, 15000)}
	req.Clips[0].Pinned = true
	if _, err := s.SaveTimeline(ctx, 1, 7, 1, req); err != nil {
		t.Fatal(err)
	}
	r.Tasks[0].Status = model.TaskFailed
	v, err = s.Timeline(ctx, 1, 7, 1)
	if err != nil || len(v.InvalidClipIDs) != 1 || v.InvalidClipIDs[0] != "a" {
		t.Fatalf("失效段 %+v %v", v, err)
	}
}

func TestDramaTimeline_SaveRejectsInvalid(t *testing.T) {
	for _, tc := range []struct {
		name string
		clip model.DramaTimelineClip
		msg  string
	}{
		{"别人的素材", imageClip("x", 701, 3000), "第 1 段：素材不存在"},
		{"别的片段的版本", segClip("a", 2, 101, 0, 1000), "第 1 段：这个版本不可用"},
		{"超出素材长度", segClip("a", 1, 102, 0, 13000), "第 1 段：超出素材长度"},
		{"太短", segClip("a", 1, 101, 0, 300), "第 1 段：每段至少 0.5 秒"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := timelineRepo()
			_, err := segmentService(r).SaveTimeline(context.Background(), 1, 7, 1, &model.SaveDramaTimelineReq{Clips: []model.DramaTimelineClip{tc.clip}})
			var business *errcode.Error
			if !errors.As(err, &business) || business.Code != errcode.ErrDramaTimelineInvalid.Code || !strings.Contains(business.Msg, tc.msg) {
				t.Fatalf("错误 %v，期望 %q", err, tc.msg)
			}
			if r.TimelineRow != nil || r.SegmentVersion != 0 {
				t.Fatal("不合法时不应写入")
			}
		})
	}
}

func TestDramaTimeline_Ownership(t *testing.T) {
	s := segmentService(timelineRepo())
	_, err := s.Timeline(context.Background(), 2, 7, 1)
	segmentCode(t, err, errcode.ErrDramaNotFound.Code)
	_, err = s.SaveTimeline(context.Background(), 1, 7, 9, &model.SaveDramaTimelineReq{})
	segmentCode(t, err, errcode.ErrDramaNotFound.Code)
}
