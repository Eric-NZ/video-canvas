import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Segment } from "@/api/drama/type";
import { installDom, type DomEnv } from "@/tests/helpers/dom";
import type { BoardNode, BoardStatus } from "@/utils/drama/board";
import type {
  BoardProgress as BoardProgressType,
  BoardStage as BoardStageType,
  ViewSwitch as ViewSwitchType,
} from "@/pages/drama/studio/board-stage";
import type {
  PreviewView,
  Studio,
  StudioContext as StudioContextType,
} from "@/pages/drama/studio/use-studio";

/**
 * 片场里的故事板（故事板并进片场）：预览顶部「故事板 | 视频」切换、故事板一面按状态显示、
 * 顶部条的故事板进度和「补齐故事板」。
 */

let dom: DomEnv;
let BoardStage: typeof BoardStageType;
let ViewSwitch: typeof ViewSwitchType;
let BoardProgress: typeof BoardProgressType;
let StudioContext: typeof StudioContextType;
beforeAll(async () => {
  dom = await installDom();
  const mod = await import("@/pages/drama/studio/board-stage");
  BoardStage = mod.BoardStage;
  ViewSwitch = mod.ViewSwitch;
  BoardProgress = mod.BoardProgress;
  StudioContext = (await import("@/pages/drama/studio/use-studio")).StudioContext;
});
afterAll(() => dom.restore());

const segment = (seq: number, over: Partial<Segment> = {}): Segment =>
  ({
    id: `s${seq}`,
    seq,
    seconds: 8,
    prompt: "【时间轴】\n0-3秒：全景。",
    status: "idle",
    takes: [],
    chosenTaskId: "",
    ...over,
  }) as Segment;

const node = (over: Partial<BoardNode> = {}): BoardNode => ({
  segmentId: "s0",
  sourceHash: "h",
  layout: "2x2",
  shotCount: 3,
  nodeId: "b1",
  src: "https://cdn/31.png",
  assetId: "31",
  status: "done",
  error: "",
  ...over,
});

/** 假的片场状态：statuses 是每个片段的故事板状态，记下调用 */
function studio(over: {
  segments?: Segment[];
  statuses?: Record<string, BoardStatus>;
  nodes?: Record<string, BoardNode>;
  view?: PreviewView;
  credits?: number;
  targets?: Segment[];
  blocked?: string | null;
}) {
  const calls = {
    canvas: [] as string[],
    generate: [] as string[][],
    fill: 0,
    video: [] as string[],
    view: [] as PreviewView[],
  };
  const segments = over.segments ?? [segment(0)];
  const value = {
    selected: segments[0],
    segments,
    submitting: new Set<string>(),
    openBoardInCanvas: (nodeId: string) => void calls.canvas.push(nodeId),
    view: over.view ?? "board",
    setView: (v: PreviewView) => calls.view.push(v),
    actions: { generate: async (s: Segment) => void calls.video.push(s.id) },
    boards: {
      statusOf: (s: Segment) => over.statuses?.[s.id] ?? "empty",
      nodeOf: (s: Segment) => over.nodes?.[s.id],
      model: undefined,
      credits: over.credits ?? 4,
      targets: over.targets ?? [],
      ready: Object.values(over.statuses ?? {}).filter((s) => s === "ready").length,
      blocked: over.blocked ?? null,
      generate: async (list: Segment[]) => void calls.generate.push(list.map((s) => s.id)),
      fill: async () => void (calls.fill += 1),
    },
  } as unknown as Studio;
  return { value, calls };
}

const mount = (value: Studio, el: React.ReactElement) =>
  dom.mount(<StudioContext.Provider value={value}>{el}</StudioContext.Provider>);
const button = (c: HTMLElement, text: string) =>
  [...c.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));

describe("片场故事板：预览的「故事板 | 视频」切换", () => {
  test("两面各带状态：故事板过期写「过期」；点视频切过去", async () => {
    const { value, calls } = studio({ statuses: { s0: "stale" } });
    const m = await mount(value, <ViewSwitch />);
    const radios = [...m.container.querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual(["故事板过期", "视频"]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    await dom.click(radios[1]);
    expect(calls.view).toEqual(["video"]);
    await m.unmount();
  });
});

describe("片场故事板：故事板这一面", () => {
  test("还没有：虚线框 + 「生成 · 积分」，点了只生成这一段", async () => {
    const { value, calls } = studio({});
    const m = await mount(value, <BoardStage />);
    expect(m.container.textContent).toContain("还没有故事板");
    expect(m.container.querySelector("img")).toBeNull();
    await dom.click(button(m.container, "生成"));
    expect(calls.generate).toEqual([["s0"]]);
    await m.unmount();
  });

  test("出过图：显示宫格图和镜头 / 宫格；「进入画布查看」跳到画布并定位这个节点", async () => {
    const { value, calls } = studio({ statuses: { s0: "ready" }, nodes: { s0: node() } });
    const m = await mount(value, <BoardStage />);
    expect(m.container.querySelector("img")?.getAttribute("src")).toBe("https://cdn/31.png");
    expect(m.container.textContent).toContain("3 镜 · 2×2 · 16:9");
    expect(m.container.textContent).not.toContain("原稿已改");
    expect(button(m.container, "用这张生成视频")).toBeUndefined();
    await dom.click(button(m.container, "进入画布查看"));
    expect(calls.canvas).toEqual(["b1"]);
    await m.unmount();
  });

  test("原稿改过：左上角「原稿已改 · 重新生成」", async () => {
    const { value, calls } = studio({ statuses: { s0: "stale" }, nodes: { s0: node() } });
    const m = await mount(value, <BoardStage />);
    expect(m.container.textContent).toContain("原稿已改");
    await dom.click(
      [...m.container.querySelectorAll("button")].find((b) => b.textContent === "重新生成"),
    );
    expect(calls.generate).toEqual([["s0"]]);
    await m.unmount();
  });

  test("失败：写原因，可以重新生成；不能生成时按钮置灰并写原因", async () => {
    const failed = studio({
      statuses: { s0: "failed" },
      nodes: { s0: node({ src: null, status: "error", error: "生成超时，积分已退回" }) },
    });
    const m = await mount(failed.value, <BoardStage />);
    expect(m.container.textContent).toContain("生成失败");
    expect(m.container.textContent).toContain("生成超时，积分已退回");
    await m.unmount();

    const blocked = studio({ blocked: "没有可用的图片模型" });
    const m2 = await mount(blocked.value, <BoardStage />);
    const go = button(m2.container, "生成") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    expect(go.title).toBe("没有可用的图片模型");
    await m2.unmount();
  });
});

describe("片场故事板：顶部条「补齐故事板」", () => {
  test("有要补的才能点，按钮上是还要补的张数，悬停写已可用张数 / 片段数；没有进度条文字", async () => {
    const segments = [segment(0), segment(1), segment(2)];
    const { value, calls } = studio({
      segments,
      statuses: { s0: "ready", s1: "stale", s2: "empty" },
      targets: [segments[1], segments[2]],
    });
    const m = await mount(value, <BoardProgress />);
    expect(m.container.textContent).not.toContain("1/3");
    const fill = button(m.container, "补齐故事板") as HTMLButtonElement;
    expect(fill.textContent).toContain("· 2");
    expect(fill.title).toContain("已可用 1/3");
    await dom.click(fill);
    expect(calls.fill).toBe(1);
    await m.unmount();

    const done = studio({ segments: [segment(0)], statuses: { s0: "ready" } });
    const m2 = await mount(done.value, <BoardProgress />);
    expect((button(m2.container, "补齐故事板") as HTMLButtonElement).disabled).toBe(true);
    await m2.unmount();
  });
});
