package model

// StoryboardSplitReq 是「从剧本拆分镜」的请求：剧本正文由前端按连线顺序拼好再传上来。
type StoryboardSplitReq struct {
	NodeID string `json:"node_id" binding:"required,max=64" label:"分镜表节点"`
	Script string `json:"script" binding:"required" label:"剧本"`
	Model  string `json:"model" binding:"max=128" label:"模型"` // Agent 模型 key；空或已下架时用第一个可用的
}

// StoryboardShot 是拆分镜输出的一镜，字段和画布分镜表的镜头一致（没有 id，写进表格时由前端分配）。
type StoryboardShot struct {
	Scene    string  `json:"scene"`    // 画面描述
	Shot     string  `json:"shot"`     // 景别
	Camera   string  `json:"camera"`   // 运镜
	Action   string  `json:"action"`   // 动作 / 走位
	Dialogue string  `json:"dialogue"` // 对白
	Duration float64 `json:"duration"` // 时长（秒），1–60
}

// StoryboardSplitResp 是拆分镜的结果：镜头、实扣积分和实际用的模型。
type StoryboardSplitResp struct {
	Shots   []StoryboardShot `json:"shots"`
	Credits int              `json:"credits"`
	Model   string           `json:"model"`
}
