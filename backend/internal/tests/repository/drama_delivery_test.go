package repository_test

import (
	"context"
	"fmt"
	"testing"

	"gorm.io/gorm"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/provider"
	"video-canvas/internal/repository"
	"video-canvas/internal/service"
)

type deliveryAssets struct {
	service.DramaShareAssets
	fail              bool
	copies, discarded int
}

func (a *deliveryAssets) Get(_ context.Context, user, id uint64) (*model.Asset, error) {
	if user != 42 || id < 10 || id > 11 {
		return nil, provider.ErrAssetNotFound
	}
	return &model.Asset{ID: id, UserID: user}, nil
}
func (a *deliveryAssets) EnsureSha256(_ context.Context, _, id uint64) (string, *model.Asset, error) {
	return fmt.Sprint(id), nil, nil
}
func (a *deliveryAssets) CopyBySha256(_ context.Context, user uint64, sha string, _ int64) (*model.Asset, error) {
	if a.fail && a.copies > 0 {
		return nil, service.ErrAssetUnreadable
	}
	a.copies++
	return &model.Asset{UserID: user, StorageKey: fmt.Sprintf("new-%d-%s", a.copies, sha), Kind: "video", MimeType: "video/mp4", Source: "upload"}, nil
}
func (a *deliveryAssets) DiscardCopies(_ context.Context, rows []*model.Asset) {
	a.discarded += len(rows)
}
func (a *deliveryAssets) FileURL(key string) string { return "/files/" + key }

func shareSeed(t *testing.T) (*gorm.DB, *service.DramaShareService, *deliveryAssets) {
	t.Helper()
	db := isolatedDB(t, &model.User{}, &model.DramaProject{}, &model.CanvasProject{}, &model.DramaEpisode{}, &model.DramaUnit{}, &model.DramaSegment{}, &model.GenerationTask{}, &model.StoryboardSplitJob{}, &model.DramaJob{}, &model.DramaViewer{}, &model.DramaDelivery{}, &model.Asset{})
	user := uint64(42)
	id := uint64(8)
	canvas := uint64(9)
	final := uint64(11)
	chosen := uint64(21)
	seg := uint64(70)
	graph := fmt.Sprintf(`{"nodes":[{"id":"board","type":"canvas","data":{"assetId":"10","src":"/files/old","drama":{"board":{"segmentId":"%s"}}}}],"edges":[]}`, idcodec.Encode(seg))
	rows := []any{&model.User{Username: "viewer", Email: "viewer@example.test"}, &model.DramaProject{BaseModel: model.BaseModel{ID: id}, UserID: user, CanvasID: canvas, Title: "剧"}, &model.CanvasProject{BaseModel: model.BaseModel{ID: canvas}, DramaID: &id, UserID: user, PayloadJSON: []byte(graph)}, &model.DramaEpisode{BaseModel: model.BaseModel{ID: 60}, UserID: user, DramaID: id, No: 1, ScriptMD: "正文", FinalAssetID: &final}, &model.DramaSegment{BaseModel: model.BaseModel{ID: seg}, UserID: user, EpisodeID: 60, ChosenTaskID: &chosen}}
	for index := range 2 {
		rows = append(rows, &model.GenerationTask{ID: uint64(20 + index), UserID: user, CanvasProjectID: &canvas, NodeID: "seg:" + idcodec.Encode(seg), Kind: "video", Status: "succeeded", InputJSON: []byte(`{}`), ConfigSnapshot: []byte(`{}`), OutputJSON: []byte(fmt.Sprintf(`[{"asset_id":%d,"media_type":"video"}]`, 10+index))})
	}
	for _, row := range rows {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	assets := &deliveryAssets{}
	return db, service.NewDramaShareService(repository.NewDramaShareRepository(db), assets), assets
}

func TestDramaSharingDelivery(t *testing.T) {
	for _, mode := range []string{"copy", "transfer"} {
		t.Run(mode, func(t *testing.T) {
			db, svc, _ := shareSeed(t)
			ctx := context.Background()
			req := model.DramaShareReq{Mode: "view", Email: "Viewer@example.test", RequestKey: "delivery"}
			if err := svc.Share(ctx, 42, 8, req); err != nil {
				t.Fatal(err)
			}
			view, err := svc.Read(ctx, 1, 8)
			if err != nil || len(view.Episodes) != 1 || len(view.Episodes[0].Segments[0].Videos) != 2 {
				t.Fatalf("只读: %+v %v", view, err)
			}
			req.Mode = mode
			for range 2 {
				if err := svc.Share(ctx, 42, 8, req); err != nil {
					t.Fatal(err)
				}
			}
			var projects []model.DramaProject
			if err := db.Where("user_id = 1").Find(&projects).Error; err != nil || len(projects) != 1 {
				t.Fatalf("重复交付: %+v %v", projects, err)
			}
			repo := repository.NewDramaShareRepository(db)
			snapshot, err := repo.Snapshot(ctx, 1, projects[0].ID, false)
			if err != nil {
				t.Fatal(err)
			}
			if len(snapshot.Tasks) != 2 || len(snapshot.Segments) != 1 || snapshot.Segments[0].ChosenTaskID == nil || *snapshot.Segments[0].ChosenTaskID != snapshot.Tasks[1].ID || *snapshot.Episodes[0].FinalAssetID == 11 {
				t.Fatalf("副本未保留独立版本: %+v", snapshot)
			}
			_, err = svc.Read(ctx, 1, 8)
			if (mode == "transfer") != (err != nil) {
				t.Fatalf("原授权: %v", err)
			}
			if _, err := repo.Snapshot(ctx, 42, 8, false); (mode == "transfer") != (err != nil) {
				t.Fatalf("原主访问: %v", err)
			}
		})
	}
}

func TestDramaSharingDeliveryRollback(t *testing.T) {
	db, svc, assets := shareSeed(t)
	ctx := context.Background()
	assets.fail = true
	if err := svc.Share(ctx, 42, 8, model.DramaShareReq{Mode: "transfer", Email: "viewer@example.test", RequestKey: "rollback"}); err == nil {
		t.Fatal("缺少素材仍然成功")
	}
	var count int64
	if err := db.Model(&model.DramaProject{}).Where("user_id = 1").Count(&count).Error; err != nil || count != 0 || assets.discarded != 1 {
		t.Fatalf("回滚: %d %d %v", count, assets.discarded, err)
	}
	if _, err := repository.NewDramaShareRepository(db).Snapshot(ctx, 42, 8, false); err != nil {
		t.Fatal(err)
	}
}

func TestSharedWorkspaceGrant(t *testing.T) {
	_, svc, _ := shareSeed(t)
	ctx := context.Background()
	if err := svc.Share(ctx, 42, 8, model.DramaShareReq{Mode: "view", Email: "viewer@example.test"}); err != nil {
		t.Fatal(err)
	}
	view, err := svc.Workspace(ctx, 1, 8)
	if err != nil {
		t.Fatal(err)
	}
	if view.Canvas.ID != 9 || view.Episodes[1].ScriptMD != "正文" || len(view.Segments[1][0].Takes) != 2 || view.Segments[1][0].ChosenTaskID != idcodec.Encode(21) {
		t.Fatalf("工作台数据不完整: %+v", view)
	}
	if _, err := svc.Workspace(ctx, 42, 9); err == nil {
		t.Fatal("错误的项目范围")
	}
	if err := svc.Remove(ctx, 42, 8, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Workspace(ctx, 1, 8); err == nil {
		t.Fatal("撤销后仍有访问权")
	}
}
