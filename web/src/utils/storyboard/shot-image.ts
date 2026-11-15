import type { StoryboardShot } from "@/types";
import type { VideoNodeView } from "@/utils/tasks/node-view";

/** 关联的图片节点此刻的情况：不在画布上，或在，带上它的展示状态 */
export type LinkedNode = { exists: false } | { exists: true; view: VideoNodeView };

/** 分镜图格该显示什么（设计 §6.5）；「上传中」是格子自己的本地瞬态，不在这里 */
export type ShotImageState =
  | { kind: "empty" }
  | { kind: "uploaded"; src: string }
  | { kind: "node"; phase: "idle" }
  | { kind: "node"; phase: "queued" }
  | { kind: "node"; phase: "running"; progress: number | null }
  | { kind: "node"; phase: "done"; src: string }
  | { kind: "node"; phase: "failed"; message: string };

/**
 * 一行的分镜图格状态：手传的图优先；其次是关联的图片节点，实时读它（状态不在行上另存一份）；
 * 节点已被删（AC8）或根本没有来源就是空。
 * @param linked 关联节点的情况；这一行没有 imageNodeId 时传 undefined
 */
export function shotImageState(
  shot: Pick<StoryboardShot, "image" | "imageNodeId">,
  linked: LinkedNode | undefined,
): ShotImageState {
  if (shot.image) return { kind: "uploaded", src: shot.image.src };
  if (!shot.imageNodeId || !linked?.exists) return { kind: "empty" };
  const v = linked.view;
  switch (v.phase) {
    case "queued":
      return { kind: "node", phase: "queued" };
    case "running":
      return { kind: "node", phase: "running", progress: v.progress };
    // 即将完成（转存中）也算生成中，只是没有进度可说
    case "finalizing":
      return { kind: "node", phase: "running", progress: null };
    case "done":
      return { kind: "node", phase: "done", src: v.src };
    case "failed":
      return { kind: "node", phase: "failed", message: v.message };
    // 本地传图进来的节点没有生成任务，当作还没生成
    default:
      return { kind: "node", phase: "idle" };
  }
}
