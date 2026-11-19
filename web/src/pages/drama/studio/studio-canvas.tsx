import { useCallback, useRef } from "react";

import type { CanvasEditorCommands } from "@/components/canvas-editor/editor-api";
import { useApplyCanvasFocus } from "@/hooks/use-apply-canvas-focus";
import type { CanvasNode } from "@/types";

import { CanvasTools } from "../workspace/assets-overlay";
import { DramaCanvas, withNewDrama } from "../workspace/assets-area";
import { useStudio } from "./use-studio";

/** 编辑器插槽里的元素放在模块顶层，引用不变，页面重渲染时不会牵动编辑器：片场的画布只要底部工具条和视图控件 */
const overlay = <CanvasTools />;

/** 片场里新建的节点和资产管理里画布视图新建的一样：默认「全集」 */
const onNodeCreate = (node: CanvasNode) => withNewDrama(node, null);

/**
 * 片场的画布视图：当前这张短剧画布（和资产管理里是同一张），在片场里直接看、改故事板节点。
 * 只在选了「画布」时才挂载（编辑器要拿编辑锁、开销大），切回「列表」就卸载。
 * 从故事板点「进入画布查看」进来时，画布挂好后飞到那个节点。
 */
export function StudioCanvas() {
  const { focusNode, clearFocusNode } = useStudio();
  const commands = useRef<CanvasEditorCommands | null>(null);
  const done = useCallback(() => clearFocusNode(), [clearFocusNode]);
  useApplyCanvasFocus(focusNode, commands, done);
  return (
    <div className="relative size-full">
      {/* 绝对定位铺满：编辑器的 h-full 才有确定的高度可依 */}
      <div className="absolute inset-0">
        <DramaCanvas overlay={overlay} commandsRef={commands} onNodeCreate={onNodeCreate} />
      </div>
    </div>
  );
}
