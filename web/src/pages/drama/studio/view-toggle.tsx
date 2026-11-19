import { ViewToggle } from "../workspace/assets-area";
import { useStudio } from "./use-studio";

/** 片场顶部条左边的「列表 | 画布」切换（和资产管理同款）：画布视图里就是当前这张短剧画布，在片场里直接看、改故事板节点 */
export function StudioViewToggle() {
  const { canvasView, setCanvasView } = useStudio();
  return <ViewToggle view={canvasView} onChange={setCanvasView} />;
}
