import { NodeToolbar, Position, useReactFlow } from "@xyflow/react";
import { motion } from "motion/react";
import { Maximize2 } from "lucide-react";

import { NodeCard, type NodeCardHandle } from "@/components/canvas";
import { BaseNodeContent } from "@/components/canvas/base-node";
import { ChromeButton, ChromePill } from "@/components/canvas/chrome/chrome";
import {
  StoryboardDialog,
  StoryboardEmpty,
  StoryboardStats,
} from "@/components/storyboard/storyboard-dialog";
import { NODE_META } from "@/constants/canvas";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { useStoryboardEditor } from "@/store/storyboard-editor";
import type { CanvasNode, CanvasNodeData } from "@/types";
import {
  addShot,
  emptyStoryboard,
  formatShotNumber,
  storyboardCardView,
} from "@/utils/storyboard/shots";

/**
 * 分镜表左边接剧本（文本）节点；右边的输出口先隐藏，迭代 2 按行生成分镜图 / 视频时从这里连出去。
 */
const STORYBOARD_HANDLES: NodeCardHandle[] = [
  { type: "target", position: Position.Left },
  { type: "source", position: Position.Right, hidden: true },
];

/** 卡片宽度：表格节点不需要画幅，比默认节点窄（设计 §2） */
const CARD_WIDTH = 480;

/** 功能区离节点上沿的距离（屏幕像素） */
const TOOLBAR_OFFSET = 44;

/**
 * 分镜表节点（设计 docs/design/分镜表节点 §2）：标题行右侧是「N 镜 · 总时长」，
 * 正文是前 5 镜的缩略图条和前 3 镜的摘要，卡片只读这几镜，不随表格行数变重。
 * 双击或选中后功能区的「编辑分镜」打开表格编辑弹窗，弹窗常驻挂载，用 open 开关。
 */
export function StoryboardCanvasNode({
  id,
  data,
  selected,
}: {
  id: string;
  data: CanvasNodeData;
  selected?: boolean;
}) {
  const { updateNodeData } = useReactFlow<CanvasNode>();
  const KindIcon = NODE_META.get("storyboard")?.icon;
  const board = data.storyboard ?? emptyStoryboard();
  const view = storyboardCardView(board);
  const editorOpen = useStoryboardEditor((state) => state.nodeId === id);
  const focusShotId = useStoryboardEditor((state) =>
    state.nodeId === id ? state.focusShotId : null,
  );
  const openEditor = () => useStoryboardEditor.getState().open(id);

  /** 空状态的「添加镜头」：加第 1 行，打开弹窗并聚焦它的画面描述 */
  const addFirst = () => {
    const shotId = crypto.randomUUID();
    updateNodeData(id, { storyboard: addShot(board, () => shotId) });
    useStoryboardEditor.getState().open(id, shotId);
  };

  return (
    <NodeCard
      title={data.label}
      onRename={(label) => updateNodeData(id, { label })}
      icon={KindIcon ? <KindIcon /> : undefined}
      status={
        board.shots.length > 0 ? (
          <StoryboardStats board={board} className="text-muted-foreground" />
        ) : undefined
      }
      handles={STORYBOARD_HANDLES}
      width={CARD_WIDTH}
    >
      {selected && (
        <NodeToolbar isVisible position={Position.Top} offset={TOOLBAR_OFFSET}>
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
            className="nodrag nopan"
          >
            <ChromePill>
              <ChromeButton onClick={openEditor}>
                <Maximize2 />
                <span className="text-foreground text-sm">编辑分镜</span>
              </ChromeButton>
            </ChromePill>
          </motion.div>
        </NodeToolbar>
      )}
      <BaseNodeContent>
        {board.shots.length === 0 ? (
          <div className="bg-muted grid aspect-video w-full place-items-center rounded-[inherit]">
            <StoryboardEmpty onAdd={addFirst} />
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-3">
            <div className="grid grid-cols-5 gap-1.5">
              {view.thumbs.map(({ number, shot }, i) => (
                <div
                  key={shot.id}
                  className="bg-muted relative flex aspect-video flex-col items-center justify-center overflow-hidden rounded-sm"
                >
                  <span className="text-base leading-none font-semibold tabular-nums">
                    {formatShotNumber(number)}
                  </span>
                  {shot.shot && (
                    <span className="text-muted-foreground mt-0.5 text-[10px]">{shot.shot}</span>
                  )}
                  {i === view.thumbs.length - 1 && view.moreThumbs > 0 && (
                    <span className="absolute inset-0 grid place-items-center bg-black/55 text-sm font-semibold text-white">
                      +{view.moreThumbs}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-col">
              {view.summary.map(({ number, shot }) => (
                <div key={shot.id} className="flex h-8 items-center gap-2 text-xs">
                  <span className="w-5 shrink-0 font-semibold tabular-nums">
                    {formatShotNumber(number)}
                  </span>
                  {(shot.shot || shot.camera) && (
                    <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5">
                      {[shot.shot, shot.camera].filter(Boolean).join(" / ")}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{shot.scene}</span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {shot.duration}s
                  </span>
                </div>
              ))}
              {view.moreSummary > 0 && (
                <p className="text-muted-foreground pt-1 text-xs">还有 {view.moreSummary} 镜</p>
              )}
            </div>
          </div>
        )}
      </BaseNodeContent>
      <StoryboardDialog
        id={id}
        label={data.label}
        board={board}
        open={editorOpen}
        focusShotId={focusShotId}
        onOpenChange={(open) => (open ? openEditor() : useStoryboardEditor.getState().close())}
      />
    </NodeCard>
  );
}
