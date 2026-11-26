import type { AssetDto } from "@/api/asset/type";

/** 素材面板拖进时间线用的 dataTransfer 类型 */
export const TIMELINE_DRAG_TYPE = "application/x-vc-timeline";

/** 拖进时间线的东西：片段的某条结果、已经读到详情的素材，或只知道 ID 的画布素材（放下时再读时长） */
export type TimelineDragPayload =
  | { type: "take"; segmentId: string; taskId: string }
  | { type: "asset"; asset: AssetDto }
  | { type: "canvas"; assetId: string };

/** 开始拖：写进 dataTransfer */
export function startTimelineDrag(event: React.DragEvent, payload: TimelineDragPayload) {
  event.dataTransfer.setData(TIMELINE_DRAG_TYPE, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = "copy";
}

/** 拖的是不是素材面板里的东西（dragover 时读不到内容，只能看类型） */
export const isTimelineDrag = (event: React.DragEvent): boolean =>
  event.dataTransfer.types.includes(TIMELINE_DRAG_TYPE);

/** 放下时读出拖的东西；不是素材面板来的返回 null */
export function readTimelineDrag(event: React.DragEvent): TimelineDragPayload | null {
  const raw = event.dataTransfer.getData(TIMELINE_DRAG_TYPE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TimelineDragPayload;
  } catch {
    return null;
  }
}
