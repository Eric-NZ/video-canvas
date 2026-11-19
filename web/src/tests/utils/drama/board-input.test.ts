import { describe, expect, test } from "bun:test";

import type { Capabilities, ModelInfo } from "@/api/model/type";
import type { CanvasEdge, CanvasNode, CanvasNodeData } from "@/types";
import {
  boardNodePosition,
  boardNodeSeed,
  ensureBoardNode,
  pickBoardModel,
  type BoardFlow,
} from "@/utils/drama/board-input";

/** 图片模型：文生图 + 图生图，参考图 ≤ max，有比例参数 */
const image = (over: { max?: number } = {}): Capabilities => ({
  ops: ["t2i", "i2i"],
  refs: {
    image: { on: true, max: over.max ?? 4, max_mb: 10 },
    audio: { on: false, max: 0, max_mb: 0 },
    video: { on: false, max: 0, max_mb: 0 },
  },
  prompt: { max_length: 4000 },
  params: {
    aspect_ratio: {
      type: "enum",
      label: "比例",
      open: true,
      default: "1:1",
      options: ["1:1", "9:16", "16:9"],
    },
  },
});

const model = (caps: Capabilities = image()): ModelInfo => ({
  key: "img-1",
  kind: "image",
  label: "图片模型",
  pricing: {} as ModelInfo["pricing"],
  capabilities: caps,
});

const PROMPT = `【场景与光】@[周家厨房](n_kitchen)，午后。
【参考与人物】@[闰土](n_runtu) 外貌；@[已删的道具](n_gone)。
【时间轴】
0-3秒：全景。闰土靠着灶台。
3-6秒：中景。闰土抬头。`;

/** 故事板提示词模板（项目设置里选的那份） */
const TEMPLATE =
  "生成一张 {{格数}} 格分镜图：{{列数}} 列 {{行数}} 行，整图比例 {{比例}}。\n{{画面}}";

describe("boardNodeSeed：故事板节点的初始数据", () => {
  test("内置提示词、16:9、模型、drama.board 标记，以及要连线的资产节点（只连画布上还在的）", () => {
    const seed = boardNodeSeed({
      segment: { id: "s1", seq: 0, prompt: PROMPT },
      episodeNo: 3,
      hash: "h1",
      model: model(),
      template: TEMPLATE,
      nodeIds: new Set(["n_kitchen", "n_runtu"]),
    });
    expect(seed.label).toBe("故事板 · 第 3 集 · 01");
    expect(seed.data.prompt).toContain("4 格分镜图");
    expect(seed.data.prompt).toContain("整图比例 16:9");
    expect(seed.data.params).toEqual({ prompt: seed.data.prompt, aspect_ratio: "16:9" });
    expect(seed.data.model).toBe("img-1");
    expect(seed.data.drama).toEqual({
      episodes: [3],
      board: { segmentId: "s1", sourceHash: "h1", layout: "2x2", shotCount: 2 },
    });
    // 没有资产类型：不进资产列表，也不能被片段 @ 引用
    expect(seed.data.drama.type).toBeUndefined();
    expect(seed.refs).toEqual(["n_kitchen", "n_runtu"]);
  });

  test("提示词按传入的模板拼：自定义模板里的文字和占位符都生效", () => {
    const seed = boardNodeSeed({
      segment: { id: "s1", seq: 0, prompt: PROMPT },
      episodeNo: 1,
      hash: "h",
      model: model(),
      template: "水彩 {{格数}} 格\n{{画面}}",
      nodeIds: new Set(),
    });
    expect(seed.data.prompt.startsWith("水彩 4 格\n")).toBe(true);
    expect(seed.data.params).toMatchObject({ prompt: seed.data.prompt });
  });

  test("参考图有上限：只连前几个；没有模型时不带模型和比例，也不连线", () => {
    const one = boardNodeSeed({
      segment: { id: "s1", seq: 0, prompt: PROMPT },
      episodeNo: 1,
      hash: "h",
      model: model(image({ max: 1 })),
      template: TEMPLATE,
      nodeIds: new Set(["n_kitchen", "n_runtu"]),
    });
    expect(one.refs).toEqual(["n_kitchen"]);
    const none = boardNodeSeed({
      segment: { id: "s1", seq: 0, prompt: PROMPT },
      episodeNo: 1,
      hash: "h",
      model: undefined,
      template: TEMPLATE,
      nodeIds: new Set(["n_kitchen"]),
    });
    expect(none.data.model).toBeUndefined();
    expect(none.data.params).toEqual({ prompt: none.data.prompt });
    expect(none.refs).toEqual([]);
  });
});

describe("pickBoardModel：故事板用哪个图片模型", () => {
  const m = (key: string): ModelInfo => ({ ...model(), key, label: key });
  const models = [m("a"), m("b"), m("c")];

  test("本机选过且仍可用 → 建剧时的场景模型 → 第一个", () => {
    expect(pickBoardModel(models, "c", "b")?.key).toBe("c");
    expect(pickBoardModel(models, "", "b")?.key).toBe("b");
    expect(pickBoardModel(models, "gone", "gone")?.key).toBe("a");
    expect(pickBoardModel([], "a", "b")).toBeUndefined();
  });
});

describe("boardNodePosition：故事板节点放在哪", () => {
  const node = (id: string, x: number, y: number, board = false) => ({
    id,
    position: { x, y },
    width: 100,
    height: 50,
    data: board ? { drama: { episodes: [1], board: { segmentId: id } } } : {},
  });

  test("放在所有非故事板节点右边留出间距，每集一行、每段一列", () => {
    const nodes = [
      node("a", 0, 40, false),
      node("b", 300, -20, false),
      node("old", 5000, 5000, true),
    ];
    const size = { width: 576, height: 324 };
    // 资产最右边到 400，最上边 -20；故事板节点自己不参与算基准
    expect(boardNodePosition(nodes, 1, 0, size)).toEqual({ x: 800, y: -20 });
    expect(boardNodePosition(nodes, 1, 2, size)).toEqual({ x: 800 + 2 * (576 + 48), y: -20 });
    expect(boardNodePosition(nodes, 3, 0, size)).toEqual({ x: 800, y: -20 + 2 * (324 + 96) });
  });

  test("画布上还没有别的节点：从原点开始", () => {
    expect(boardNodePosition([], 1, 1, { width: 576, height: 324 })).toEqual({ x: 624, y: 0 });
  });
});

describe("ensureBoardNode：建 / 改故事板节点", () => {
  /** 内存里的假画布：只实现故事板要用的几个操作 */
  function fakeFlow(nodes: CanvasNode[]) {
    const edges: CanvasEdge[] = [];
    const updates: Array<[string, Partial<CanvasNodeData>]> = [];
    const flow: BoardFlow = {
      getNodes: () => nodes,
      getEdges: () => edges,
      addNodes: (node) => nodes.push(node),
      addEdges: (list) => edges.push(...list),
      updateNodeData: (id, update) => {
        const node = nodes.find((n) => n.id === id)!;
        const patch = update(node);
        updates.push([id, patch]);
        node.data = { ...node.data, ...patch };
      },
    };
    return { flow, nodes, edges, updates };
  }
  const kitchen: CanvasNode = {
    id: "n_kitchen",
    type: "canvas",
    position: { x: 0, y: 0 },
    data: {
      kind: "image",
      label: "厨房",
      drama: { type: "scene", name: "周家厨房", episodes: [] },
    },
  };

  test("第一次：在故事板区新建 16:9 图片节点，带片段标记，连上原稿里 @ 的资产", () => {
    const { flow, nodes, edges } = fakeFlow([kitchen]);
    const id = ensureBoardNode(flow, {
      segment: { id: "s1", seq: 0, prompt: PROMPT },
      episodeNo: 1,
      hash: "h1",
      model: model(),
      template: TEMPLATE,
    });
    const created = nodes.find((n) => n.id === id)!;
    expect(created.data).toMatchObject({
      kind: "image",
      label: "故事板 · 第 1 集 · 01",
      model: "img-1",
      drama: { episodes: [1], board: { segmentId: "s1", sourceHash: "h1" } },
    });
    expect(created.position.x).toBeGreaterThan(0);
    expect(edges.map((e) => [e.source, e.target])).toEqual([["n_kitchen", id]]);
  });

  test("再次生成：改已有节点的提示词和标记，保留用户在节点上换过的模型，连线不重复", () => {
    const { flow, nodes, edges, updates } = fakeFlow([kitchen]);
    const id = ensureBoardNode(flow, {
      segment: { id: "s1", seq: 0, prompt: PROMPT },
      episodeNo: 1,
      hash: "h1",
      model: model(),
      template: TEMPLATE,
    });
    nodes.find((n) => n.id === id)!.data.model = "user-picked";
    const again = ensureBoardNode(flow, {
      segment: { id: "s1", seq: 0, prompt: `${PROMPT}\n6-9秒：近景。` },
      episodeNo: 1,
      hash: "h2",
      model: model(),
      template: TEMPLATE,
    });
    expect(again).toBe(id);
    expect(nodes.filter((n) => n.data.drama?.board)).toHaveLength(1);
    expect(updates[0][1]).toMatchObject({
      model: "user-picked",
      drama: { board: { sourceHash: "h2", shotCount: 3 } },
    });
    expect(edges).toHaveLength(1);
  });
});
