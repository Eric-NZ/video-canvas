import { createContext, useContext, type RefObject } from "react";

import type { EpisodeSummary } from "@/api/drama/type";
import type { CanvasEditorCommands } from "@/components/canvas-editor/editor-api";

/** 故事板页的视图状态：头部（在编辑器外）和列表 / 画布外壳（在编辑器里）共用 */
export type BoardsUi = {
  view: "list" | "canvas";
  setView: (view: "list" | "canvas") => void;
  episode: EpisodeSummary;
  /** 顶栏右侧的位置：就绪数、图片模型、批量生成要读实时节点，从编辑器内透传过来 */
  headerTarget: HTMLDivElement | null;
  commands: RefObject<CanvasEditorCommands | null>;
};

export const BoardsUiContext = createContext<BoardsUi | null>(null);

/** 取故事板页的视图状态；只能在故事板页内部用 */
export function useBoardsUi(): BoardsUi {
  const value = useContext(BoardsUiContext);
  if (!value) throw new Error("useBoardsUi 必须在故事板页内部使用");
  return value;
}
