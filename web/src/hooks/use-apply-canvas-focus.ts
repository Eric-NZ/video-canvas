import { useEffect, type RefObject } from "react";

import type { CanvasEditorCommands } from "@/components/canvas-editor/editor-api";
import { useCanvasFocusStore } from "@/store/drama-canvas-focus";

/** 编辑器要等画布加载完才有命令表，每帧试一次，最多等这么多帧（约 5 秒） */
const MAX_FRAMES = 300;

/**
 * 资产画布挂载后兑现片场的「进入画布查看」：取走这部短剧待定位的节点，
 * 等编辑器的命令表里能读到它，再切到画布视图并飞过去。没有请求时什么都不做。
 * @param dramaId 短剧 id
 * @param commands 编辑器的命令表（挂载后才有）
 * @param showCanvas 切到画布视图
 */
export function useApplyCanvasFocus(
  dramaId: string,
  commands: RefObject<CanvasEditorCommands | null>,
  showCanvas: () => void,
) {
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const apply = () => {
      const nodeId = useCanvasFocusStore.getState().byDrama[dramaId];
      if (!nodeId) return;
      if (!commands.current?.getNodes().some((node) => node.id === nodeId)) {
        if (++tries < MAX_FRAMES) frame = requestAnimationFrame(apply);
        return;
      }
      useCanvasFocusStore.getState().take(dramaId);
      showCanvas();
      // 视图切过去、节点渲染出来后再飞，让用户看得到
      requestAnimationFrame(() => commands.current?.focusNode(nodeId));
    };
    apply();
    return () => cancelAnimationFrame(frame);
  }, [dramaId, commands, showCanvas]);
}
