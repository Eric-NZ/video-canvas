import { Position, useReactFlow } from "@xyflow/react";

import { NodeCard, type NodeCardHandle } from "@/components/canvas";
import { BaseNodeContent } from "@/components/canvas/base-node";
import { NODE_META } from "@/constants/canvas";
import type { CanvasNode, CanvasNodeData } from "@/types";
import { emptyStoryboard, formatDuration, totalDuration } from "@/utils/storyboard/shots";

/**
 * 分镜表左边接剧本（文本）节点；右边的输出口先隐藏，迭代 2 按行生成分镜图 / 视频时从这里连出去。
 */
const STORYBOARD_HANDLES: NodeCardHandle[] = [
  { type: "target", position: Position.Left },
  { type: "source", position: Position.Right, hidden: true },
];

/**
 * 分镜表节点（PRD 分镜表节点 §6.1）：卡片上摆镜头数和总时长，表格编辑区等设计稿出来再接。
 * 选中时不出功能区和生成面板（toolbarGate 里关掉）。
 */
export function StoryboardCanvasNode({ id, data }: { id: string; data: CanvasNodeData }) {
  const { updateNodeData } = useReactFlow<CanvasNode>();
  const meta = NODE_META.get("storyboard");
  const KindIcon = meta?.icon;
  const PlaceholderIcon = meta?.placeholderIcon;
  const board = data.storyboard ?? emptyStoryboard();
  const count = board.shots.length;

  return (
    <NodeCard
      title={data.label}
      onRename={(label) => updateNodeData(id, { label })}
      icon={KindIcon ? <KindIcon /> : undefined}
      handles={STORYBOARD_HANDLES}
    >
      <BaseNodeContent>
        <div className="bg-muted relative flex aspect-video w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-[inherit]">
          {count === 0 ? (
            PlaceholderIcon && (
              <PlaceholderIcon className="text-muted-foreground size-10 opacity-60" />
            )
          ) : (
            <p className="text-foreground text-sm tabular-nums">
              {count} 个镜头 · {formatDuration(totalDuration(board))}
            </p>
          )}
        </div>
      </BaseNodeContent>
    </NodeCard>
  );
}
