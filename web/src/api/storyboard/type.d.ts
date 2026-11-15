/** 「从剧本拆分镜」接口的入参 */
export interface StoryboardSplitRequest {
  /** 分镜表节点 id，用来做「同一张表同时只拆一次」的锁 */
  node_id: string;
  /** 剧本正文：连了多个剧本节点时由前端按连线顺序拼好 */
  script: string;
  /** Agent 模型 key，空串表示用后台第一个可用的 */
  model: string;
}

/** 后端返回的一镜，字段和分镜表的 StoryboardShot 对齐（没有 id，由前端分配） */
export interface StoryboardSplitShotDto {
  scene: string;
  shot: string;
  camera: string;
  action: string;
  dialogue: string;
  duration: number;
}

/** 「从剧本拆分镜」接口的返回 */
export interface StoryboardSplitResponse {
  shots: StoryboardSplitShotDto[];
  /** 实扣积分，失败不扣 */
  credits: number;
  /** 实际用的模型 key（用户选的下架时会回落到第一个可用的） */
  model: string;
}
