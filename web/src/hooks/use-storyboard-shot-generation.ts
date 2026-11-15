import { useCallback, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";

import { submitNodeWhenReady } from "@/components/canvas-editor/node-actions";
import { useFocusNode } from "@/components/canvas-editor/use-focus-node";
import { ANIMATED_EDGE_OPTIONS } from "@/constants/canvas";
import { useRemoteModels } from "@/hooks/use-models";
import { useModelsStore } from "@/store/models";
import { useSettingsStore } from "@/store/settings";
import { useStoryboardEditor } from "@/store/storyboard-editor";
import type { CanvasEdge, CanvasNode } from "@/types";
import { pickDefaultModel } from "@/utils/canvas/default-model";
import { newNodeLabel } from "@/utils/canvas/node-label";
import { DEFAULT_NODE_ASPECT, nodeFrameSize } from "@/utils/canvas/node-frame";
import { placeInColumn } from "@/utils/canvas/place-beside";
import { shotImagePrompt } from "@/utils/storyboard/prompt";
import { emptyStoryboard, formatShotNumber, linkShot } from "@/utils/storyboard/shots";

/** 改完提示词后等一小会儿再提交：节点要重新渲染一次，提交读的才是新的提示词 */
const SETTLE_MS = 60;

/**
 * 分镜表按行生成（PRD 6.5）：
 * - generateImage：这一行还没有图片节点就在分镜表右侧按镜号竖排建一个、从分镜表连线过去，
 *   提示词由这一行拼出来，用设置里的默认图片模型，建好就自动开始生成；
 *   已经有图片节点就复用它（用这一行现在的内容重写提示词再生成），不新建；
 * - locate：关掉弹窗，把画布飞到关联节点。
 * 结果不用回填：分镜图格实时读关联节点。
 * @param storyboardId 分镜表节点 id
 */
export function useStoryboardShotGeneration(storyboardId: string) {
  const { getNode, getNodes, addNodes, addEdges, updateNodeData } = useReactFlow<
    CanvasNode,
    CanvasEdge
  >();
  const focusNode = useFocusNode();
  // 让图片模型清单开始加载：新节点要等它才能提交
  useRemoteModels("image");
  /** 正在处理的行：同一行连点只处理一次，免得建出两个节点 */
  const busy = useRef(new Set<string>());

  const generateImage = useCallback(
    async (shotId: string) => {
      if (busy.current.has(shotId)) return;
      const source = getNode(storyboardId);
      const board = source?.data.storyboard;
      if (!source || !board) return;
      const index = board.shots.findIndex((s) => s.id === shotId);
      if (index < 0) return;
      const shot = board.shots[index];
      const no = formatShotNumber(index + 1);
      if (!shot.scene.trim()) {
        toast.error(`先写第 ${no} 镜的画面描述`);
        return;
      }
      busy.current.add(shotId);
      try {
        const prompt = shotImagePrompt(shot);
        const existing = shot.imageNodeId ? getNode(shot.imageNodeId) : undefined;
        let nodeId = existing?.data.kind === "image" ? existing.id : undefined;
        if (nodeId) {
          // 复用：用这一行现在的内容重写提示词（模型、参数是用户在节点上调过的，不动）
          updateNodeData(nodeId, (node) => ({ prompt, params: { ...node.data.params, prompt } }));
          await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
        } else {
          nodeId = crypto.randomUUID();
          const nodes = getNodes();
          const model = pickDefaultModel(
            useSettingsStore.getState().defaultModels.image,
            useModelsStore.getState().byKind.image?.models ?? [],
          );
          addNodes({
            id: nodeId,
            type: "canvas",
            position: placeInColumn({
              source,
              nodes,
              size: nodeFrameSize(DEFAULT_NODE_ASPECT),
              slot: index,
            }),
            data: {
              kind: "image",
              label: newNodeLabel(
                `镜头 ${no}`,
                nodes.map((n) => n.data.label),
              ),
              prompt,
              params: { prompt },
              ...(model ? { model } : {}),
            },
          });
          addEdges({
            id: `xy-edge__${storyboardId}-${nodeId}`,
            source: storyboardId,
            target: nodeId,
            ...ANIMATED_EDGE_OPTIONS,
          } as CanvasEdge);
          const created = nodeId;
          updateNodeData(storyboardId, (node) => ({
            storyboard: linkShot(node.data.storyboard ?? emptyStoryboard(), shotId, {
              imageNodeId: created,
            }),
          }));
        }
        const reason = await submitNodeWhenReady(nodeId);
        // 没能开始（积分不足、模型不可用……）：节点已经建好，用户可以到节点上处理后再点生成
        if (reason) toast.error(`第 ${no} 镜没能开始生成：${reason}`);
      } finally {
        busy.current.delete(shotId);
      }
    },
    [addEdges, addNodes, getNode, getNodes, storyboardId, updateNodeData],
  );

  const locate = useCallback(
    (nodeId: string) => {
      useStoryboardEditor.getState().close();
      focusNode(nodeId);
    },
    [focusNode],
  );

  return { generateImage, locate };
}
