import { useCallback } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { toast } from "sonner";

import { splitStoryboard } from "@/api/storyboard";
import { useCanvasHistoryContext } from "@/hooks/use-canvas-history";
import {
  IDLE,
  splitDisabledReason,
  useStoryboardSplit,
  type SplitState,
} from "@/store/storyboard-split";
import type { CanvasEdge, CanvasNode } from "@/types";
import { useCurrentCanvasId } from "@/utils/canvas/canvas-id";
import { ApiError } from "@/utils/requests/request";
import { emptyStoryboard, normalizeStoryboard } from "@/utils/storyboard/shots";
import { upstreamScripts, type UpstreamScripts } from "@/utils/storyboard/upstream-scripts";

/** 上游剧本读数只看这三项：值没变就不重渲染，画布拖动时每帧不会带着节点重渲染 */
const sameScripts = (a: UpstreamScripts, b: UpstreamScripts) =>
  a.script === b.script && a.count === b.count && a.hasScript === b.hasScript;

/** 订阅分镜表上游剧本：连线、剧本正文变了才更新（拆分镜按钮是否可点靠它） */
export function useUpstreamScripts(id: string): UpstreamScripts {
  return useStore(
    (state) =>
      upstreamScripts(id, state.nodes as CanvasNode[], state.edges as unknown as CanvasEdge[]),
    sameScripts,
  );
}

/** 读某个节点当前的拆分状态；节点、弹窗、功能区各自订阅 */
export const useSplitStateOf = (id: string): SplitState =>
  useStoryboardSplit((s) => s.states[id] ?? IDLE);

/**
 * 分镜表节点拆分镜的动作（设计 §6.1–6.4）：
 * - run：调后端，成功后按 mode 把镜头覆盖或追加进节点，镜头 id 在前端分配；失败不扣费，原因进横幅；
 * - trigger：用户点「拆分镜」，表里已有镜头时先弹覆盖 / 追加 / 取消，没有就直接覆盖（空表）；
 * - retry：失败横幅的「重试」，沿用失败那次的模式。
 * 模型从 store 取，三个入口选的是同一份。
 * @param id 分镜表节点 id
 */
export function useStoryboardSplitAction(id: string) {
  const canvasId = useCurrentCanvasId();
  const { getNode, getNodes, getEdges, updateNodeData } = useReactFlow<CanvasNode, CanvasEdge>();
  const history = useCanvasHistoryContext();

  const run = useCallback(
    async (mode: "replace" | "append") => {
      const split = useStoryboardSplit.getState();
      if (!canvasId || split.stateOf(id).phase === "running") return;
      const scripts = upstreamScripts(id, getNodes(), getEdges());
      if (!scripts.script) return;
      split.start(id, mode);
      try {
        const res = await splitStoryboard(canvasId, {
          node_id: id,
          script: scripts.script,
          model: split.model,
        });
        const node = getNode(id);
        if (!node) {
          // 拆分期间节点被删了：没有地方可写，也不留下失败横幅
          useStoryboardSplit.getState().dismiss(id);
          return;
        }
        const incoming = normalizeStoryboard({ shots: res.shots }).shots;
        const existing = node.data.storyboard ?? emptyStoryboard();
        const shots = mode === "replace" ? incoming : [...existing.shots, ...incoming];
        updateNodeData(id, { storyboard: { shots } });
        useStoryboardSplit.getState().done(
          id,
          incoming.map((s) => s.id),
        );
        // 覆盖丢掉了原来的镜头：给一个能撤销的出口（画布撤销栈已盯着分镜表的改动）
        if (mode === "replace" && existing.shots.length > 0) {
          toast.success(`已覆盖为 ${incoming.length} 个镜头`, {
            action: { label: "撤销", onClick: () => history?.undo() },
          });
        }
      } catch (err) {
        const reason = err instanceof ApiError ? err.message : "网络异常，请稍后重试";
        useStoryboardSplit.getState().fail(id, reason);
        // 弹窗关着时用户看不到横幅，靠 toast 告知；弹窗开着时横幅已经说明，toast 也无妨
        toast.error(`拆分镜失败：${reason}`);
      }
    },
    [canvasId, getEdges, getNode, getNodes, history, id, updateNodeData],
  );

  const trigger = useCallback(() => {
    const existing = getNode(id)?.data.storyboard?.shots.length ?? 0;
    if (existing > 0) useStoryboardSplit.getState().askOverwrite(id, existing);
    else void run("replace");
  }, [getNode, id, run]);

  const retry = useCallback(() => {
    const state = useStoryboardSplit.getState().stateOf(id);
    if (state.phase === "failed") void run(state.mode);
  }, [id, run]);

  return { run, trigger, retry };
}

/**
 * 三个入口（弹窗标题栏、节点功能区、空状态）共用的拆分镜状态：按钮是否可点和原因、进行中、触发和重试。
 * @param id 分镜表节点 id
 */
export function useStoryboardSplitUi(id: string) {
  const scripts = useUpstreamScripts(id);
  const state = useSplitStateOf(id);
  const { trigger, run, retry } = useStoryboardSplitAction(id);
  const reason = splitDisabledReason(scripts.hasScript, !scripts.script, state.phase);
  return { state, reason, busy: state.phase === "running", trigger, run, retry };
}
