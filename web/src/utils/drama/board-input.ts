import type { Segment } from "@/api/drama/type";
import type { ModelInfo } from "@/api/model/type";
import { ANIMATED_EDGE_OPTIONS } from "@/constants/canvas";
import type { CanvasEdge, CanvasNode, CanvasNodeData, NodeDrama } from "@/types";
import { nodeFrameSize } from "@/utils/canvas/node-frame";
import { parsePrompt } from "@/utils/canvas/prompt-tokens";

import {
  BOARD_RATIO,
  boardPrompt,
  boardsFromGraph,
  isBoardNode,
  type NodeBoardMeta,
} from "./board";
import { segmentParams } from "./video-models";

/** 故事板节点的初始数据：交给画布节点，生成由节点自己按模型能力组装 input */
export type BoardSeed = {
  /** 节点标题，如「故事板 · 第 3 集 · 01」 */
  label: string;
  data: {
    prompt: string;
    params: Record<string, unknown>;
    model?: string;
    /** 没有 type：不进资产列表，也不能被片段 @ 引用 */
    drama: NodeDrama & { board: NodeBoardMeta };
  };
  /** 要连线到故事板节点的资产节点：原稿里 @ 的、画布上还在的，按出现顺序，不超过参考图上限 */
  refs: string[];
  /** 给用户看的提醒（没识别到时间轴、镜头过多），没有为空串 */
  notice: string;
};

/**
 * 按片段原稿拼一个故事板节点：内置宫格提示词、整图 16:9、所选图片模型、drama.board 标记（片段与出图时的原稿哈希），
 * 以及要连进来的资产节点（参考图靠连线带入，提示词里的 @ 由节点展开成图片编号）。
 */
export function boardNodeSeed(args: {
  segment: Pick<Segment, "id" | "seq" | "prompt">;
  episodeNo: number;
  /** 当前原稿的 SHA-256 */
  hash: string;
  model: ModelInfo | undefined;
  /** 画布上现有的节点 id */
  nodeIds: ReadonlySet<string>;
}): BoardSeed {
  const built = boardPrompt(args.segment.prompt);
  const caps = args.model?.capabilities;
  const max = caps?.refs?.image?.on ? caps.refs.image.max : 0;
  const refs: string[] = [];
  for (const seg of parsePrompt(built.text)) {
    if (seg.type !== "ref" || refs.includes(seg.id) || !args.nodeIds.has(seg.id)) continue;
    if (refs.length >= max) break;
    refs.push(seg.id);
  }
  const no = String(args.segment.seq + 1).padStart(2, "0");
  return {
    label: `故事板 · 第 ${args.episodeNo} 集 · ${no}`,
    data: {
      prompt: built.text,
      params: {
        prompt: built.text,
        ...segmentParams(caps, { seconds: 0, ratio: BOARD_RATIO, overrides: {} }),
      },
      ...(args.model ? { model: args.model.key } : {}),
      drama: {
        episodes: [args.episodeNo],
        board: {
          segmentId: args.segment.id,
          sourceHash: args.hash,
          layout: built.layout,
          shotCount: built.shotCount,
        },
      },
    },
    refs,
    notice: built.notice,
  };
}

/**
 * 故事板默认用哪个图片模型：本机选过且仍在清单里就沿用；否则用建剧时选的场景图片模型；都没有取第一个。
 * @param models 图片模型清单
 * @param savedKey 本机偏好，空串 = 没选
 * @param projectKey 建剧时的场景图片模型，空串 = 没指定
 */
export function pickBoardModel(
  models: readonly ModelInfo[],
  savedKey: string,
  projectKey: string,
): ModelInfo | undefined {
  return (
    models.find((info) => !!savedKey && info.key === savedKey) ??
    models.find((info) => !!projectKey && info.key === projectKey) ??
    models[0]
  );
}

/** 故事板区离资产区的距离、格子之间的间距（像素） */
const BOARD_AREA_GAP = 400;
const BOARD_COL_GAP = 48;
const BOARD_ROW_GAP = 96;

/**
 * 新故事板节点的位置：放在所有非故事板节点的右边，每集一行、每段一列，不和资产挤在一起。
 * 已有的故事板节点不参与算基准（用户拖动过也不影响新节点的排布）。
 * @param nodes 画布上现有的节点
 * @param episodeNo 集号，从 1 起
 * @param seq 片段序号，从 0 起
 * @param size 节点框大小
 */
export function boardNodePosition(
  nodes: readonly {
    position: { x: number; y: number };
    width?: number;
    measured?: { width?: number };
    data: object;
  }[],
  episodeNo: number,
  seq: number,
  size: { width: number; height: number },
): { x: number; y: number } {
  let right = -BOARD_AREA_GAP;
  let top = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    if (isBoardNode(node.data)) continue;
    const width = node.measured?.width ?? node.width ?? 0;
    right = Math.max(right, node.position.x + width);
    top = Math.min(top, node.position.y);
  }
  const baseX = right + BOARD_AREA_GAP;
  const baseY = Number.isFinite(top) ? top : 0;
  return {
    x: baseX + seq * (size.width + BOARD_COL_GAP),
    y: baseY + (episodeNo - 1) * (size.height + BOARD_ROW_GAP),
  };
}

/** 建 / 改故事板节点要用到的画布操作（React Flow 实例的子集，测试里可以直接传假的） */
export type BoardFlow = {
  getNodes: () => CanvasNode[];
  getEdges: () => CanvasEdge[];
  addNodes: (node: CanvasNode) => void;
  addEdges: (edges: CanvasEdge[]) => void;
  updateNodeData: (id: string, update: (node: CanvasNode) => Partial<CanvasNodeData>) => void;
};

/** 故事板节点框：16:9 横版 */
const BOARD_SIZE = nodeFrameSize(16 / 9);

/**
 * 建好或更新一个片段的故事板节点，返回节点 id（同步完成，批量时按顺序建、不会抢位置）：
 * 已有节点就用现在的原稿重写提示词和 drama.board（模型、参数是用户在节点上调过的，不动）；
 * 没有就在故事板区按集 / 段排开新建。原稿里 @ 的资产节点连线进来，参考图靠连线带入。
 */
export function ensureBoardNode(
  flow: BoardFlow,
  args: {
    segment: Pick<Segment, "id" | "seq" | "prompt">;
    episodeNo: number;
    hash: string;
    model: ModelInfo | undefined;
  },
): string {
  const nodes = flow.getNodes();
  const current = boardsFromGraph(nodes).get(args.segment.id);
  const seed = boardNodeSeed({ ...args, nodeIds: new Set(nodes.map((node) => node.id)) });
  let id: string;
  if (current) {
    id = current.nodeId;
    flow.updateNodeData(id, (node) => ({
      prompt: seed.data.prompt,
      params: { ...node.data.params, ...seed.data.params },
      model: node.data.model ?? seed.data.model,
      drama: seed.data.drama,
    }));
  } else {
    id = crypto.randomUUID();
    flow.addNodes({
      id,
      type: "canvas",
      position: boardNodePosition(nodes, args.episodeNo, args.segment.seq, BOARD_SIZE),
      data: { kind: "image", label: seed.label, ...seed.data },
    });
  }
  const edges = flow.getEdges();
  const missing = seed.refs.filter(
    (source) => !edges.some((edge) => edge.source === source && edge.target === id),
  );
  if (missing.length > 0) {
    flow.addEdges(
      missing.map(
        (source) =>
          ({
            id: `xy-edge__${source}-${id}`,
            source,
            target: id,
            ...ANIMATED_EDGE_OPTIONS,
          }) as CanvasEdge,
      ),
    );
  }
  return id;
}
