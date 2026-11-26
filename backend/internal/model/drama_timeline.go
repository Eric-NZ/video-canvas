package model

import "gorm.io/datatypes"

// 时间线段的来源种类与素材种类。
const (
	TimelineKindSegment = "segment" // 分镜片段的某条视频结果
	TimelineKindAsset   = "asset"   // 画布素材或本地导入的素材
	TimelineMediaVideo  = "video"
	TimelineMediaImage  = "image"
)

// 时间线变更种类：对账时片场改动给时间线带来的变化。
const (
	TimelineChangeRemoved   = "removed"   // 片段被删除，段已移除
	TimelineChangeUnadopted = "unadopted" // 片段取消了采用，段变成待采用占位
	TimelineChangeSwapped   = "swapped"   // 片段换了采用版本，段跟着换
	TimelineChangeAdopted   = "adopted"   // 待采用的片段采用了，占位变成视频
	TimelineChangeAdded     = "added"     // 新增片段，已插入时间线
)

// DramaEpisodeTimeline 一集的粗剪剪辑清单；不存在时由片段现算默认时间线，第一次保存才落库。
type DramaEpisodeTimeline struct {
	BaseModel
	UserID    uint64 `gorm:"not null;index"`
	EpisodeID uint64 `gorm:"not null;uniqueIndex:uk_drama_episode_timeline"`
	// Clips 是 []DramaTimelineClip，按播放顺序首尾相接
	Clips datatypes.JSON `gorm:"type:jsonb;not null;default:'[]'"`
	// Muted 整轨静音
	Muted bool `gorm:"not null;default:false"`
	// RemovedSegmentIDs 用户主动从轨上删掉的片段（[]uint64），对账不自动加回
	RemovedSegmentIDs datatypes.JSON `gorm:"type:jsonb;not null;default:'[]'"`
	// Imports 「已导入」里的素材（[]uint64）
	Imports  datatypes.JSON `gorm:"type:jsonb;not null;default:'[]'"`
	Revision int64          `gorm:"not null;default:1"`
}

// TableName 返回时间线表名。
func (DramaEpisodeTimeline) TableName() string { return "drama_episode_timelines" }
