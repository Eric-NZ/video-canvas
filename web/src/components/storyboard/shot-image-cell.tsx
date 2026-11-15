import type { ReactNode } from "react";
import { useStore, type ReactFlowState } from "@xyflow/react";
import { Crosshair, Image, Link2, RefreshCw, TriangleAlert, Upload, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTask } from "@/store/tasks";
import type { CanvasNodeData, StoryboardShot } from "@/types";
import { shotImageState, type LinkedNode } from "@/utils/storyboard/shot-image";
import { deriveVideoNodeView } from "@/utils/tasks/node-view";

/** 画格只关心关联节点的这几项 */
type LinkedData = Pick<
  CanvasNodeData,
  "status" | "src" | "error" | "errorTaskRef" | "taskId" | "uploadProgress"
>;

const sameLinked = (a: LinkedData | null, b: LinkedData | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.status === b.status &&
    a.src === b.src &&
    a.error === b.error &&
    a.errorTaskRef === b.errorTaskRef &&
    a.taskId === b.taskId &&
    a.uploadProgress === b.uploadProgress);

/**
 * 实时读关联节点的状态：只订阅这几项，用相等判断挡掉别的字段和位置变化，
 * 50 行都关联了节点时，一个节点的进度变化只重渲染它自己那一格（AC13）。
 */
function useLinkedImage(nodeId: string | undefined): LinkedNode | undefined {
  const data = useStore((state: ReactFlowState): LinkedData | null => {
    const d = nodeId
      ? (state.nodeLookup.get(nodeId)?.internals.userNode.data as CanvasNodeData | undefined)
      : undefined;
    return d
      ? {
          status: d.status,
          src: d.src,
          error: d.error,
          errorTaskRef: d.errorTaskRef,
          taskId: d.taskId,
          uploadProgress: d.uploadProgress,
        }
      : null;
  }, sameLinked);
  const task = useTask(data?.taskId);
  if (!nodeId) return undefined;
  if (!data) return { exists: false };
  // 耗时不显示，传 0 就行：进度条只用任务快照里的 progress
  return { exists: true, view: deriveVideoNodeView(data, task, 0) };
}

/** 画格里悬停浮出的圆形清透图标按钮；每个都有 title，不写文字（编码规范 6.2） */
function CellTool({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="nodrag bg-chrome ring-chrome-border text-foreground hover:bg-chrome-hover focus-visible:ring-node-ring/60 grid size-7 place-items-center rounded-full shadow-sm ring-1 backdrop-blur-xl outline-none focus-visible:ring-2 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

/**
 * 分镜图格：96 × 54 的 16:9 画格（设计 §6.5）。状态由行和关联节点现算：
 * 空 / 排队或生成中 / 来自关联节点（左下角链接角标）/ 生成失败 / 手动上传。
 * 操作都放在画格里，悬停或键盘聚焦才浮出，图标按钮：生成用图片图标（本表所有地方都不用 ✦）。
 * @param uploading 这一格正在上传的进度（0–100）；没在上传为 undefined
 * @param dragging 有图片正拖在这一行上：整行任何位置都算拖到这一格，格子画出虚线框
 * @param onGenerate 生成 / 重新生成（复用同一个图片节点）
 * @param onUpload 点「上传」选文件
 * @param onRemove 移除手传的图
 * @param onLocate 关掉弹窗，把画布飞到关联节点
 */
export function ShotImageCell({
  shot,
  number,
  uploading,
  dragging,
  onGenerate,
  onUpload,
  onRemove,
  onLocate,
}: {
  shot: StoryboardShot;
  number: number;
  uploading?: number;
  dragging?: boolean;
  onGenerate: () => void;
  onUpload: () => void;
  onRemove: () => void;
  onLocate: (nodeId: string) => void;
}) {
  const linked = useLinkedImage(shot.imageNodeId);
  const state = shotImageState(shot, linked);
  const generating =
    state.kind === "node" && (state.phase === "queued" || state.phase === "running");
  const regenerate = state.kind === "node" && (state.phase === "done" || state.phase === "failed");
  const src =
    state.kind === "uploaded" || (state.kind === "node" && state.phase === "done")
      ? state.src
      : null;

  return (
    <div
      tabIndex={0}
      data-slot="shot-image-cell"
      title={state.kind === "node" && state.phase === "failed" ? state.message : undefined}
      className={cn(
        "group/thumb bg-muted text-muted-foreground/50 focus-visible:ring-node-ring/60 relative grid h-[54px] w-24 place-items-center overflow-hidden rounded-md outline-none focus-visible:ring-2",
        generating && "animate-pulse",
        dragging && "ring-node-ring ring-2",
        state.kind === "node" && state.phase === "failed" && "bg-destructive/10 text-destructive",
      )}
    >
      {src ? (
        <img
          src={src}
          alt={`第 ${number} 镜分镜图`}
          draggable={false}
          className={cn("size-full object-cover", uploading !== undefined && "opacity-40")}
        />
      ) : state.kind === "node" && state.phase === "failed" ? (
        <span className="flex flex-col items-center gap-0.5 text-[11px]">
          <TriangleAlert className="size-4" />
          生成失败
        </span>
      ) : generating ? (
        <span className="text-status-running text-[11px] tabular-nums">
          {state.phase === "queued"
            ? "排队中"
            : state.phase === "running" && state.progress !== null
              ? `生成中 ${state.progress}%`
              : "生成中"}
        </span>
      ) : (
        <Image className="size-5" />
      )}
      {state.kind === "node" && state.phase === "done" && (
        <span
          data-slot="shot-image-link"
          className="bg-chrome absolute bottom-1 left-1 grid size-4 place-items-center rounded-full backdrop-blur-xl"
        >
          <Link2 className="text-foreground size-2.5" />
        </span>
      )}
      {uploading !== undefined && (
        <span className="text-foreground absolute inset-0 grid place-items-center bg-black/30 text-[11px] tabular-nums">
          上传中 {uploading}%
        </span>
      )}
      {dragging && (
        <span className="border-node-ring text-foreground absolute inset-1 grid place-items-center rounded border border-dashed">
          <Upload className="size-4" />
        </span>
      )}
      {uploading === undefined && (
        <div className="absolute inset-x-0 bottom-1 flex justify-center gap-1 opacity-0 transition-opacity group-focus-within/thumb:opacity-100 group-hover/thumb:opacity-100">
          {!generating &&
            (regenerate ? (
              <CellTool title="重新生成" onClick={onGenerate}>
                <RefreshCw />
              </CellTool>
            ) : (
              <CellTool title="生成分镜图" onClick={onGenerate}>
                <Image />
              </CellTool>
            ))}
          {!generating && (
            <CellTool title={src ? "替换" : "上传分镜图"} onClick={onUpload}>
              <Upload />
            </CellTool>
          )}
          {state.kind === "uploaded" && (
            <CellTool title="移除" onClick={onRemove}>
              <X />
            </CellTool>
          )}
          {state.kind === "node" && shot.imageNodeId && (
            <CellTool title="在画布中定位" onClick={() => onLocate(shot.imageNodeId!)}>
              <Crosshair />
            </CellTool>
          )}
        </div>
      )}
    </div>
  );
}
