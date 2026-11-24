package service

import (
	"context"
	"errors"
	"reflect"
	"strings"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/provider"
	"video-canvas/internal/repository"
)

// DramaShareAssets provides owner-checked media access and independent asset copies.
type DramaShareAssets interface {
	TransferAssets
	Get(context.Context, uint64, uint64) (*model.Asset, error)
	Open(context.Context, uint64, uint64) (*provider.AssetFile, error)
}

// DramaShareService manages read grants and independent drama deliveries.
type DramaShareService struct {
	repo   *repository.DramaShareRepository
	assets DramaShareAssets
}

// NewDramaShareService constructs the sharing service.
func NewDramaShareService(repo *repository.DramaShareRepository, assets DramaShareAssets) *DramaShareService {
	return &DramaShareService{repo: repo, assets: assets}
}

func shareError(err error) error {
	switch {
	case errors.Is(err, repository.ErrNotFound):
		return errcode.ErrDramaNotFound
	case errors.Is(err, repository.ErrInUse):
		return errcode.ErrDramaJobBusy
	case errors.Is(err, repository.ErrRevisionConflict):
		return errcode.ErrCanvasConflict
	case errors.Is(err, provider.ErrAssetNotFound), errors.Is(err, ErrAssetUnreadable), errors.Is(err, ErrAssetNotFoundByHash):
		return errcode.ErrAssetNotFound.WithMsg("短剧素材缺失，无法交付")
	default:
		return err
	}
}

// Share grants view access or delivers a copy / transfer to another account.
func (s *DramaShareService) Share(ctx context.Context, user, id uint64, req model.DramaShareReq) error {
	recipient, err := s.repo.Recipient(ctx, strings.ToLower(strings.TrimSpace(req.Email)))
	if errors.Is(err, repository.ErrNotFound) || recipient == user {
		return errcode.ErrInvalidParams.WithMsg("请输入其他可接收用户的邮箱")
	}
	if err != nil {
		return err
	}
	switch req.Mode {
	case "view":
		return shareError(s.repo.Grant(ctx, user, id, recipient))
	case "copy", "transfer":
		return shareError(s.deliver(ctx, model.DramaDelivery{UserID: user, DramaID: id, Recipient: recipient, RequestKey: req.RequestKey, Mode: req.Mode}))
	default:
		return errcode.ErrInvalidParams
	}
}

func (s *DramaShareService) deliver(ctx context.Context, request model.DramaDelivery) error {
	claimed, err := s.repo.Claim(ctx, request)
	if err != nil || !claimed {
		return err
	}
	snapshot, clone, copies, err := s.prepareDelivery(ctx, request)
	if err != nil {
		_ = s.repo.Release(context.WithoutCancel(ctx), request)
		return err
	}
	err = s.commitDelivery(ctx, request, snapshot, clone, copies)
	if err != nil {
		s.assets.DiscardCopies(context.WithoutCancel(ctx), copies)
		_ = s.repo.Release(context.WithoutCancel(ctx), request)
	}
	return err
}

func (s *DramaShareService) prepareDelivery(ctx context.Context, request model.DramaDelivery) (*repository.DramaSnapshot, *shareClone, []*model.Asset, error) {
	snapshot, err := s.repo.Snapshot(ctx, request.UserID, request.DramaID, true)
	if err != nil {
		return nil, nil, nil, err
	}
	clone := &shareClone{graph: shareGraph{assets: map[uint64]*sharedAsset{}, segments: map[string]string{}}, episodeIDs: map[uint64]uint64{}, taskIDs: map[uint64]uint64{}, user: request.Recipient}
	if err := clone.graph.collect(snapshot); err != nil {
		return nil, nil, nil, err
	}
	copies, err := s.prepare(ctx, &clone.graph, request)
	if err != nil {
		s.assets.DiscardCopies(context.WithoutCancel(ctx), copies)
		return nil, nil, nil, err
	}
	return snapshot, clone, copies, nil
}

func (s *DramaShareService) commitDelivery(ctx context.Context, request model.DramaDelivery, snapshot *repository.DramaSnapshot, clone *shareClone, copies []*model.Asset) error {
	return s.repo.WithTx(ctx, func(tx *repository.DramaShareRepository) error {
		return s.writeDelivery(ctx, tx, request, snapshot, clone, copies)
	})
}

func (s *DramaShareService) writeDelivery(ctx context.Context, tx *repository.DramaShareRepository, request model.DramaDelivery, snapshot *repository.DramaSnapshot, clone *shareClone, copies []*model.Asset) error {
	if err := tx.LockSnapshot(ctx, request.UserID, request.DramaID); err != nil {
		return err
	}
	current, err := tx.Snapshot(ctx, request.UserID, request.DramaID, true)
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(snapshot, current) {
		return repository.ErrRevisionConflict
	}
	for _, assetCopy := range copies {
		if err := tx.SaveNew(ctx, assetCopy); err != nil {
			return err
		}
	}
	if err := clone.write(ctx, tx, snapshot); err != nil {
		return err
	}
	if request.Mode == "transfer" {
		if err := tx.Retire(ctx, request.UserID, request.DramaID); err != nil {
			return err
		}
	}
	request.ResultID = clone.drama
	return tx.Complete(ctx, request)
}

func (s *DramaShareService) prepare(ctx context.Context, graph *shareGraph, req model.DramaDelivery) ([]*model.Asset, error) {
	var copies []*model.Asset
	for _, ref := range graph.assets {
		source, err := s.assets.Get(ctx, req.UserID, ref.original)
		if err != nil {
			return copies, err
		}
		if source.Source == model.AssetSourceOfficial {
			ref.asset, ref.url = source, source.PublicURL
			continue
		}
		sha, _, err := s.assets.EnsureSha256(ctx, req.UserID, ref.original)
		if err != nil {
			return copies, err
		}
		assetCopy, err := s.assets.CopyBySha256(ctx, req.Recipient, sha, source.ByteSize)
		if err != nil {
			return copies, err
		}
		assetCopy.FileName = source.FileName
		ref.asset, ref.url = assetCopy, s.assets.FileURL(assetCopy.StorageKey)
		copies = append(copies, assetCopy)
	}
	return copies, nil
}

// Members lists viewers for an owned drama.
func (s *DramaShareService) Members(ctx context.Context, user, id uint64) ([]model.DramaMember, error) {
	items, err := s.repo.Members(ctx, user, id)
	return items, shareError(err)
}

// Remove revokes viewer access or leaves a shared drama.
func (s *DramaShareService) Remove(ctx context.Context, user, id, member uint64) error {
	return shareError(s.repo.Remove(ctx, user, id, member))
}

// Shared lists dramas shared with the user.
func (s *DramaShareService) Shared(ctx context.Context, user uint64, keyword string, page, size int) ([]model.DramaSharedItem, int64, error) {
	return s.repo.Shared(ctx, user, keyword, page, size)
}
