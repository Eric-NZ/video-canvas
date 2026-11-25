package model

// 预设种类：开拍设置里的题材与画风共用一张表，靠 Kind 区分。
const (
	DramaPresetKindGenre = "genre"
	DramaPresetKindStyle = "style"
)

// DramaPreset 是开拍设置的预设条目：题材（genre）只有 key + 名称，画风（style）另有正向描述与预览图。
//
// 这张表是预设目录的单一事实源。迁移前目录硬编码在 internal/drama/styles.json，
// 迁移后该文件只作为种子来源与空表兜底（见 docs/design/短剧预设后台/短剧预设后台.md）。
type DramaPreset struct {
	BaseModel
	// Kind 预设种类：genre / style，在同一事务里重排与唯一约束都按它分组
	Kind string `gorm:"size:8;not null;uniqueIndex:uk_drama_presets_kind_key,priority:1;index:idx_drama_presets_kind_order,priority:1" json:"kind"`
	// Key 预设标识，创建后不可改：drama_projects.style_key / genre 存的就是它，且没有外键
	Key string `gorm:"size:32;not null;uniqueIndex:uk_drama_presets_kind_key,priority:2" json:"key"`
	// Name 展示名称
	Name string `gorm:"size:64;not null" json:"name"`
	// Prompt 画风的正向视觉描述，会注入各步骤提示词的 style 变量；题材恒为空串
	Prompt string `gorm:"type:text;not null;default:''" json:"prompt"`
	// PreviewURL 预览图地址：内置条目是前端静态相对路径，后台上传的是平台存储地址
	PreviewURL string `gorm:"column:preview_url;size:1024;not null;default:''" json:"preview_url"`
	// SortOrder 排序，越小越靠前
	SortOrder int `gorm:"not null;default:0;index:idx_drama_presets_kind_order,priority:2" json:"sort_order"`
	// Enabled 是否出现在开拍设置里；停用不影响已有短剧继续使用该 key
	Enabled bool `gorm:"not null" json:"enabled"`
	// IsBuiltin 是否随迁移种入，仅用于后台展示来源，不参与运行时判断
	IsBuiltin bool `gorm:"not null;default:false" json:"is_builtin"`
}

// TableName 返回表名。
func (DramaPreset) TableName() string { return "drama_presets" }
