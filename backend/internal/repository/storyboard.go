package repository

import (
	"context"

	"gorm.io/gorm"

	"video-canvas/internal/model"
)

// StoryboardRepository 是画布分镜表「从剧本拆分镜」用到的存储：确认画布归属，以及扣费的积分原语。
type StoryboardRepository struct{ db *gorm.DB }

// NewStoryboardRepository 创建分镜表仓储。
func NewStoryboardRepository(db *gorm.DB) *StoryboardRepository { return &StoryboardRepository{db: db} }

// StoryboardTx 是拆分镜在事务里要用的积分原语。
type StoryboardTx interface {
	EnsureCredit(ctx context.Context, userID uint64, initial int) error
	LockCredit(ctx context.Context, userID uint64) (*model.UserCredit, error)
	AddCredit(ctx context.Context, userID uint64, balance, frozen int) error
	InsertLedger(ctx context.Context, e *model.CreditLedger) (bool, error)
}

// WithTx 只通过此入口开启事务；事务内只用 tx 参数。
func (r *StoryboardRepository) WithTx(ctx context.Context, fn func(StoryboardTx) error) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return fn(&StoryboardRepository{db: tx}) })
}

// CanvasOwned 确认画布存在且属于这个用户；不是返回 ErrNotFound。
func (r *StoryboardRepository) CanvasOwned(ctx context.Context, userID, canvasID uint64) error {
	_, err := (&CanvasProjectRepository{db: r.db}).GetByID(ctx, userID, canvasID)
	return err
}

// EnsureCredit 没有账户时按新账户初始积分建立，复用已有的初始化和流水逻辑。
func (r *StoryboardRepository) EnsureCredit(ctx context.Context, userID uint64, initial int) error {
	return insertInitialCredit(ctx, r.db, userID, initial)
}

// LockCredit 读取积分账户并加行锁。
func (r *StoryboardRepository) LockCredit(ctx context.Context, userID uint64) (*model.UserCredit, error) {
	return (&GenerationTaskRepository{db: r.db}).LockCredit(ctx, userID)
}

// AddCredit 原子更新余额和冻结额。
func (r *StoryboardRepository) AddCredit(ctx context.Context, userID uint64, balance, frozen int) error {
	return (&GenerationTaskRepository{db: r.db}).AddCredit(ctx, userID, balance, frozen)
}

// InsertLedger 写一条积分流水。
func (r *StoryboardRepository) InsertLedger(ctx context.Context, e *model.CreditLedger) (bool, error) {
	return (&GenerationTaskRepository{db: r.db}).InsertLedger(ctx, e)
}
