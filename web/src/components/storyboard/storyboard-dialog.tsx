import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { motion, Reorder } from "motion/react";
import { Plus, Sparkles } from "lucide-react";

import { ChromePill } from "@/components/canvas/chrome/chrome";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NODE_META } from "@/constants/canvas";
import { useStoryboardSplitUi } from "@/hooks/use-storyboard-split";
import { cn } from "@/lib/utils";
import { useStoryboardSplit } from "@/store/storyboard-split";
import type { CanvasNode, NodeStoryboard, StoryboardShot } from "@/types";
import {
  addShot,
  applyOrder,
  duplicateShot,
  emptyStoryboard,
  formatDuration,
  insertShot,
  removeShot,
  totalDuration,
  updateShot,
} from "@/utils/storyboard/shots";

import { SHOT_GRID_CLASS, ShotRow, STICKY_CELLS, type ShotRowActions } from "./shot-row";
import { SplitControls } from "./split-controls";
import { SplitErrorBanner, SplitProgressBar, SplitSkeletonRows } from "./split-ui";

/** 新拆进来的行高亮停留多久（毫秒），之后淡出 */
const HIGHLIGHT_MS = 1200;

/** 表格最小宽度：各列宽 + 列间距 + 行内边距，弹窗比它窄时横向滚动 */
const TABLE_MIN_WIDTH = "min-w-[1216px]";

/** 表头文字；拖拽柄、行操作两列没有表头 */
const HEADERS = ["", "镜号", "分镜图", "画面描述", "景别", "运镜", "动作/走位", "对白", "时长", ""];

/** 空状态：图标 + 一句标题 + 按钮（编码规范 6.2）；有 split 时主按钮是「从剧本拆分镜」，「添加镜头」退成次按钮 */
export function StoryboardEmpty({
  onAdd,
  split,
  title = "还没有镜头",
}: {
  onAdd: () => void;
  split?: { onSplit: () => void; reason: string };
  title?: string;
}) {
  const PlaceholderIcon = NODE_META.get("storyboard")?.placeholderIcon;
  return (
    <div className="flex flex-col items-center justify-center gap-3 text-center">
      {PlaceholderIcon && <PlaceholderIcon className="text-muted-foreground size-10 opacity-60" />}
      <p className="text-muted-foreground text-sm">{title}</p>
      <div className="flex items-center gap-2">
        {split && (
          // 禁用的按钮不收鼠标事件，禁用原因的悬停提示挂在外面一层
          <span title={split.reason || undefined} className="inline-flex">
            <Button size="sm" className="nodrag" disabled={!!split.reason} onClick={split.onSplit}>
              <Sparkles />
              从剧本拆分镜
            </Button>
          </span>
        )}
        <Button variant="outline" size="sm" className="nodrag" onClick={onAdd}>
          <Plus />
          添加镜头
        </Button>
      </div>
    </div>
  );
}

/** 「N 镜 · 总时长」统计，悬停看精确秒数 */
export function StoryboardStats({
  board,
  className,
}: {
  board: NodeStoryboard;
  className?: string;
}) {
  const total = totalDuration(board);
  return (
    <span title={`共 ${total} 秒`} className={cn("tabular-nums", className)}>
      {board.shots.length} 镜 · {formatDuration(total)}
    </span>
  );
}

/**
 * 分镜表编辑弹窗（设计 docs/design/分镜表节点 §3）：一行一镜，8 列直接改，没有「保存」按钮。
 * 下拉、时长、增删排序即时写回节点，文本框失焦才写回；都走画布自动保存和撤销。
 * 拖拽时顺序先放在本地，松手才写回节点，拖动中每帧不会写节点数据。
 */
export function StoryboardDialog({
  id,
  label,
  board,
  open,
  focusShotId,
  onOpenChange,
}: {
  id: string;
  label: string;
  board: NodeStoryboard;
  open: boolean;
  /** 打开时要聚焦画面描述的那一行 */
  focusShotId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { getNode, updateNodeData } = useReactFlow<CanvasNode>();
  const KindIcon = NODE_META.get("storyboard")?.icon;
  const [dragOrder, setDragOrder] = useState<StoryboardShot[] | null>(null);
  // 松手回调要读到拖出来的最终顺序，同一份另存在 ref 里（state 在回调里可能还是旧的）
  const dragOrderRef = useRef<StoryboardShot[] | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const focusId = addedId ?? focusShotId;
  const bodyRef = useRef<HTMLDivElement>(null);
  const { state: split, reason: splitReason, trigger, retry } = useStoryboardSplitUi(id);
  const dismissSplit = useStoryboardSplit((s) => s.dismiss);
  const highlights = useStoryboardSplit((s) => s.highlights[id]);
  const clearHighlights = useStoryboardSplit((s) => s.clearHighlights);
  const running = split.phase === "running";

  // 刚拆进来的行：滚到第一条新行，停留一会儿后清掉高亮（设计 §6.4）。
  // 滚动要读最新的表和弹窗开关，但它们变化时不该重置高亮定时器，所以放进 effect event
  const scrollToFirstNew = useEffectEvent((fresh: Set<string>) => {
    const first = board.shots.find((s) => fresh.has(s.id));
    if (!open || !first) return;
    // 等这一帧把新行渲染出来再滚
    requestAnimationFrame(() =>
      bodyRef.current
        ?.querySelector(`[data-shot-id="${CSS.escape(first.id)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  });
  useEffect(() => {
    if (!highlights || highlights.size === 0) return;
    scrollToFirstNew(highlights);
    const timer = setTimeout(() => clearHighlights(id), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlights, id, clearHighlights]);

  /** 以节点上最新的分镜表为底改一笔：行的回调引用不变，也不会拿到旧数据 */
  const commit = useCallback(
    (fn: (board: NodeStoryboard) => NodeStoryboard) => {
      const current = getNode(id)?.data.storyboard ?? emptyStoryboard();
      const next = fn(current);
      if (next !== current) updateNodeData(id, { storyboard: next });
    },
    [getNode, id, updateNodeData],
  );

  /** 加一行并聚焦它的画面描述 */
  const addAndFocus = useCallback(
    (fn: (board: NodeStoryboard, newId: () => string) => NodeStoryboard) => {
      const newId = crypto.randomUUID();
      commit((b) => fn(b, () => newId));
      setAddedId(newId);
    },
    [commit],
  );

  const actions = useMemo<ShotRowActions>(
    () => ({
      onChange: (shotId, patch) => commit((b) => updateShot(b, shotId, patch)),
      onInsert: (shotId, side) => addAndFocus((b, newId) => insertShot(b, shotId, side, newId)),
      onDuplicate: (shotId) => commit((b) => duplicateShot(b, shotId)),
      onRemove: (shotId) => commit((b) => removeShot(b, shotId)),
      onDragEnd: () => {
        const order = dragOrderRef.current;
        dragOrderRef.current = null;
        setDragOrder(null);
        if (order)
          commit((b) =>
            applyOrder(
              b,
              order.map((s) => s.id),
            ),
          );
      },
    }),
    [addAndFocus, commit],
  );

  const shots = dragOrder ?? board.shots;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setAddedId(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex h-[min(88svh,860px)] w-[min(1280px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <div className="flex shrink-0 items-center gap-3 border-b border-border/60 py-3 pr-12 pl-5">
          {KindIcon && <KindIcon className="text-muted-foreground size-4" />}
          <DialogTitle className="truncate text-sm font-semibold">{label}</DialogTitle>
          <ChromePill className="ml-auto h-9">
            <SplitControls id={id} />
          </ChromePill>
          <DialogDescription render={<div />} className="text-xs">
            <StoryboardStats board={board} />
          </DialogDescription>
        </div>
        {running && <SplitProgressBar />}
        {split.phase === "failed" && (
          <SplitErrorBanner
            reason={split.reason}
            onRetry={retry}
            onDismiss={() => dismissSplit(id)}
          />
        )}
        {board.shots.length === 0 ? (
          <div className="grid min-h-0 flex-1 place-items-center">
            {running ? (
              <div className="w-full">
                <p className="text-muted-foreground mb-3 text-center text-sm">正在拆分镜</p>
                <SplitSkeletonRows />
              </div>
            ) : (
              <StoryboardEmpty
                onAdd={() => addAndFocus(addShot)}
                split={{ onSplit: trigger, reason: splitReason }}
              />
            )}
          </div>
        ) : (
          <motion.div
            ref={bodyRef}
            layoutScroll
            // 拆分中锁住编辑，免得和即将写入的结果打架
            inert={running}
            className={cn(
              "min-h-0 flex-1 overflow-auto transition-opacity",
              running && "opacity-60",
            )}
          >
            <div className={TABLE_MIN_WIDTH}>
              <div
                className={cn(
                  SHOT_GRID_CLASS,
                  "bg-popover text-muted-foreground sticky top-0 z-[2] border-b border-border/60 px-2 py-2 text-xs font-medium",
                )}
              >
                {HEADERS.map((text, i) => (
                  <div
                    key={i}
                    className={cn(i < 3 && STICKY_CELLS[i], i === 1 && "text-center", "px-2")}
                  >
                    {text}
                    {i === 3 && <span className="text-destructive"> *</span>}
                  </div>
                ))}
              </div>
              <Reorder.Group
                as="div"
                axis="y"
                values={shots}
                onReorder={(order: StoryboardShot[]) => {
                  dragOrderRef.current = order;
                  setDragOrder(order);
                }}
              >
                {shots.map((shot, i) => (
                  <ShotRow
                    key={shot.id}
                    shot={shot}
                    number={i + 1}
                    autoFocus={shot.id === focusId}
                    highlight={highlights?.has(shot.id)}
                    actions={actions}
                  />
                ))}
              </Reorder.Group>
              {/* 追加模式：新镜头会出现在表格末尾 */}
              {running && split.mode === "append" && <SplitSkeletonRows />}
            </div>
            {/* 宽度跟可视区走，横向滚动时钉在左边 */}
            <div className="sticky left-0 px-3 pt-3 pb-4">
              <button
                type="button"
                onClick={() => addAndFocus(addShot)}
                className="text-muted-foreground hover:bg-chrome-hover hover:text-foreground focus-visible:ring-node-ring/60 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-sm outline-none focus-visible:ring-2"
              >
                <Plus className="size-4" />
                添加镜头
              </button>
            </div>
          </motion.div>
        )}
      </DialogContent>
    </Dialog>
  );
}
