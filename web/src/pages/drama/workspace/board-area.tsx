import { useMemo, useRef, useState } from "react";
import { Clapperboard, Grid2x2, Loader2 } from "lucide-react";

import type { EpisodeSummary } from "@/api/drama/type";
import type { CanvasEditorCommands } from "@/components/canvas-editor/editor-api";
import { Button } from "@/components/ui/button";
import type { WorkspaceStage } from "@/utils/drama/stages";

import type { CanvasNode } from "@/types";

import { DramaCanvas, ViewToggle, withNewDrama } from "./assets-area";
import { BoardsOverlay } from "./board-overlay";
import { BoardsUiContext, type BoardsUi } from "./board-ui";
import { useWorkspace } from "./context";

/** 编辑器插槽里的元素放在模块顶层，引用不变，页面重渲染时不会牵动编辑器 */
const overlay = <BoardsOverlay />;

/** 有分镜时的故事板页：和资产管理同一块短剧画布，列表视图盖在画布上 */
function BoardWorkspace({ episode }: { episode: EpisodeSummary }) {
  const [view, setView] = useState<"list" | "canvas">("list");
  const [headerTarget, setHeaderTarget] = useState<HTMLDivElement | null>(null);
  const commands = useRef<CanvasEditorCommands | null>(null);
  const onNodeCreate = useMemo(() => (node: CanvasNode) => withNewDrama(node, null), []);
  const ui = useMemo<BoardsUi>(
    () => ({ view, setView, episode, headerTarget, commands }),
    [episode, headerTarget, view],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <ViewToggle view={view} onChange={setView} />
        <h2 className="font-display min-w-0 truncate pl-1 text-[15px] font-bold tracking-wide">
          第 {episode.no} 集 · {episode.title}
        </h2>
        <span className="flex-1" />
        <div ref={setHeaderTarget} className="flex items-center gap-2" />
      </div>
      <div className="relative min-h-0 flex-1">
        {/* 绝对定位铺满：编辑器的 h-full 才有确定的高度可依 */}
        <div className="absolute inset-0">
          <BoardsUiContext.Provider value={ui}>
            <DramaCanvas overlay={overlay} commandsRef={commands} onNodeCreate={onNodeCreate} />
          </BoardsUiContext.Provider>
        </div>
      </div>
    </div>
  );
}

/**
 * 故事板：每个片段一张 16:9 宫格分镜图，是短剧画布上的图片节点（不是资产，不能被片段 @），
 * 可以在画布里查看、重新生成、切换历史版本；片场生视频时作为第一张参考图。
 * 分镜还没有（或在生成）时引导去片场——分镜在片场生成。
 */
export function BoardArea({
  ep,
  onGo,
}: {
  ep: number;
  onGo: (stage: WorkspaceStage, ep?: number) => void;
}) {
  const { drama } = useWorkspace();
  const episode = drama.episodes.find((item) => item.no === ep);
  if (!episode || episode.storyboardStatus !== "ready") {
    const generating = episode?.storyboardStatus === "generating";
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="bg-muted text-muted-foreground grid size-16 place-items-center rounded-[20px] [&_svg]:size-7">
          {generating ? <Loader2 className="animate-spin" /> : <Grid2x2 />}
        </span>
        <h3 className="text-[17px] font-semibold">
          {generating ? "分镜生成中" : "这一集还没有分镜"}
        </h3>
        {episode && !generating && (
          <Button variant="outline" onClick={() => onGo("studio", ep)}>
            <Clapperboard />
            去片场
          </Button>
        )}
      </div>
    );
  }
  return <BoardWorkspace episode={episode} />;
}
