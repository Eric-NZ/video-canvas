import service from "@/utils/requests/service";

import type { StoryboardSplitRequest, StoryboardSplitResponse } from "./type";

/** 调用后端「从剧本拆分镜」，错误由调用方自己处理，不弹默认 toast */
export const splitStoryboard = (canvasId: string, body: StoryboardSplitRequest) =>
  service.post<StoryboardSplitResponse>(`/canvas/${canvasId}/storyboard/split`, body, {
    silent: true,
    timeout: 60 * 1000,
  });
