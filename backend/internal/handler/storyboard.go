package handler

import (
	"github.com/gin-gonic/gin"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/response"
	"video-canvas/internal/service"
)

// StoryboardHandler 处理画布分镜表的「从剧本拆分镜」。
type StoryboardHandler struct {
	svc *service.StoryboardService
}

// NewStoryboardHandler 创建分镜表 handler。
func NewStoryboardHandler(svc *service.StoryboardService) *StoryboardHandler {
	return &StoryboardHandler{svc: svc}
}

// Split 把前端拼好的剧本拆成镜头，同步返回镜头和实扣积分；不写画布，由前端按覆盖 / 追加写进分镜表。
func (h *StoryboardHandler) Split(c *gin.Context) {
	id, ok := CanvasPathID(c)
	if !ok {
		return
	}
	var req model.StoryboardSplitReq
	if !BindJSON(c, &req) {
		return
	}
	res, err := h.svc.Split(c.Request.Context(), currentUserID(c), id, &req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, res)
}
