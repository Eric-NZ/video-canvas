import { create } from "zustand";

type CanvasFocusState = {
  /** 每部短剧待定位的画布节点 id */
  byDrama: Record<string, string>;
  /** 记下要在资产画布里看哪个节点 */
  request: (dramaId: string, nodeId: string) => void;
  /** 取走请求（取一次就清掉）；没有为 null */
  take: (dramaId: string) => string | null;
};

/**
 * 片场 →资产画布的「进入画布查看」请求。画布只在资产区挂载，片场点按钮时画布还没有，
 * 所以先记在这里，等资产区把画布挂好后取走：切到画布视图并飞到那个节点。
 */
export const useCanvasFocusStore = create<CanvasFocusState>((set, get) => ({
  byDrama: {},
  request: (dramaId, nodeId) =>
    set((state) => ({ byDrama: { ...state.byDrama, [dramaId]: nodeId } })),
  take: (dramaId) => {
    const nodeId = get().byDrama[dramaId];
    if (!nodeId) return null;
    set((state) => {
      const { [dramaId]: _, ...rest } = state.byDrama;
      return { byDrama: rest };
    });
    return nodeId;
  },
}));
