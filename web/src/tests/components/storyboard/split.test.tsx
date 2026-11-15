import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { useEffect } from "react";

import type { StoryboardSplitRequest, StoryboardSplitResponse } from "@/api/storyboard/type";
import type { useModelsStore as UseModelsStore } from "@/store/models";
import type { useStoryboardSplit as UseSplitStore } from "@/store/storyboard-split";
import type { ApiError as ApiErrorClass } from "@/utils/requests/request";
import { installDom, type DomEnv } from "@/tests/helpers/dom";
import type { CanvasEdge, CanvasNode, StoryboardShot } from "@/types";

/**
 * 分镜表「从剧本拆分镜」的界面：用 jsdom 挂载真实的弹窗、覆盖确认框和拆分状态，只把后端接口换成可控的假实现。
 * 检查入口是否可点、剧本按连线顺序拼接、覆盖 / 追加 / 取消、进行中锁表、失败横幅与重试（AC2–AC4 的前端侧）。
 */

const calls: StoryboardSplitRequest[] = [];
let impl: (body: StoryboardSplitRequest) => Promise<StoryboardSplitResponse>;
mock.module("@/api/storyboard", () => ({
  splitStoryboard: (_canvasId: string, body: StoryboardSplitRequest) => {
    calls.push(body);
    return impl(body);
  },
}));

let dom: DomEnv;
let useSplit: typeof UseSplitStore;
let useModels: typeof UseModelsStore;
let ApiErrorCtor: typeof ApiErrorClass;
let Harness: (props: { shots?: StoryboardShot[]; scripts?: string[] }) => React.ReactElement;
let latest: () => StoryboardShot[];

const apiShot = (scene: string) => ({
  scene,
  shot: "近景",
  camera: "推",
  action: "",
  dialogue: "",
  duration: 4,
});
const reply = (...scenes: string[]): StoryboardSplitResponse => ({
  shots: scenes.map(apiShot),
  credits: 5,
  model: "agent-a",
});

beforeAll(async () => {
  dom = await installDom();
  const { ReactFlowProvider, useNodes, useStoreApi } = await import("@xyflow/react");
  const { StoryboardDialog } = await import("@/components/storyboard/storyboard-dialog");
  const { SplitOverwriteDialog } = await import("@/components/storyboard/split-ui");
  const { CanvasIdContext } = await import("@/utils/canvas/canvas-id");
  useSplit = (await import("@/store/storyboard-split")).useStoryboardSplit;
  useModels = (await import("@/store/models")).useModelsStore;
  ApiErrorCtor = (await import("@/utils/requests/request")).ApiError;
  const seen: { shots: StoryboardShot[] } = { shots: [] };
  latest = () => seen.shots;

  function Body() {
    // 只有 Provider 没有 <ReactFlow> 时，store 默认不收节点改动；按画布里非受控的方式打开
    const store = useStoreApi<CanvasNode>();
    if (!store.getState().hasDefaultNodes) store.setState({ hasDefaultNodes: true });
    const node = useNodes<CanvasNode>().find((n) => n.id === "sb")!;
    const board = node.data.storyboard ?? { shots: [] };
    useEffect(() => {
      seen.shots = board.shots;
    });
    return (
      <>
        <StoryboardDialog
          id="sb"
          label={node.data.label}
          board={board}
          open
          focusShotId={null}
          onOpenChange={() => {}}
        />
        <SplitOverwriteDialog id="sb" />
      </>
    );
  }
  Harness = ({ shots = [], scripts = ["第一段剧本"] }) => {
    const script = (i: number, text: string): CanvasNode => ({
      id: `s${i}`,
      type: "canvas",
      position: { x: 0, y: i * 100 },
      data: { kind: "script", label: `剧本${i}`, text },
    });
    const edges: CanvasEdge[] = scripts.map((_, i) => ({
      id: `xy-edge__s${i}-sb`,
      source: `s${i}`,
      target: "sb",
    }));
    return (
      <CanvasIdContext.Provider value="c1">
        <ReactFlowProvider
          initialNodes={[
            {
              id: "sb",
              type: "canvas",
              position: { x: 700, y: 0 },
              data: { kind: "storyboard", label: "分镜表", storyboard: { shots } },
            },
            ...scripts.map((t, i) => script(i, t)),
          ]}
          initialEdges={edges}
        >
          <Body />
        </ReactFlowProvider>
      </CanvasIdContext.Provider>
    );
  };
});
afterAll(() => {
  useModels.setState({ byKind: {} });
  dom.restore();
});

beforeEach(() => {
  calls.length = 0;
  impl = async () => reply("默认");
  useSplit.setState({ states: {}, overwrite: null, highlights: {}, model: "" });
  useModels.setState({
    byKind: {
      agent: {
        status: "ready",
        loadedAt: Date.now(),
        models: [{ key: "agent-a", label: "Agent A", vendor: "x" }],
      },
    } as never,
  });
});

const shot = (id: string, scene: string): StoryboardShot => ({
  id,
  scene,
  shot: "中景",
  camera: "固定",
  action: "",
  dialogue: "",
  duration: 3,
});

/** 挂载并登记：用例中途断言失败也会在 afterEach 里卸载，免得残留的 DOM 让后面的查询命中旧弹窗 */
const mounted: Array<() => Promise<void>> = [];
async function mount(element: React.ReactElement) {
  const m = await dom.mount(element);
  let done = false;
  const unmount = async () => {
    if (done) return;
    done = true;
    await m.unmount();
  };
  mounted.push(unmount);
  return { ...m, unmount };
}
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
});

const body = () => dom.win.document.body;
const buttons = () => Array.from(body().querySelectorAll<HTMLButtonElement>("button"));
const buttonByText = (text: string) =>
  buttons().find((b) => b.textContent?.replace(/\s+/g, "").includes(text)) ?? null;
const splitButton = () => buttonByText("从剧本拆分镜");

/** 一个可手动放行的请求，用来停在「进行中」检查界面 */
function deferred() {
  let resolve!: (v: StoryboardSplitResponse) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<StoryboardSplitResponse>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("拆分镜入口", () => {
  test("没连剧本时按钮禁用，悬停提示「请先连接剧本节点」（AC4）", async () => {
    const m = await mount(<Harness scripts={[]} />);
    await dom.flush();
    const btn = splitButton();
    expect(btn?.disabled).toBe(true);
    expect(btn?.closest("[title]")?.getAttribute("title")).toBe("请先连接剧本节点");
    await m.unmount();
  });

  test("连了剧本但没内容：禁用并提示「剧本节点还没有内容」", async () => {
    const m = await mount(<Harness scripts={["  "]} />);
    await dom.flush();
    expect(splitButton()?.disabled).toBe(true);
    expect(splitButton()?.closest("[title]")?.getAttribute("title")).toBe("剧本节点还没有内容");
    await m.unmount();
  });

  test("空表：标题栏和空状态各有一个拆分镜入口，点任一个都直接开拆", async () => {
    impl = async () => reply("月夜瓜地", "闰土举叉");
    const m = await mount(<Harness />);
    await dom.flush();
    expect(
      buttons().filter((b) => b.textContent?.includes("从剧本拆分镜")).length,
    ).toBeGreaterThanOrEqual(2);
    await dom.click(splitButton());
    await dom.flush();
    expect(calls).toHaveLength(1);
    expect(latest().map((s) => s.scene)).toEqual(["月夜瓜地", "闰土举叉"]);
    await m.unmount();
  });
});

describe("拆分镜按钮的样子", () => {
  test("弹窗标题栏里有模型下拉，「从剧本拆分镜」按钮只有文字、没有图标", async () => {
    const m = await mount(<Harness />);
    await dom.flush();
    expect(body().textContent).toContain("Agent A");
    const title = buttons().find((b) => b.getAttribute("aria-label") === "从剧本拆分镜");
    expect(title).toBeTruthy();
    expect(title!.querySelector("svg")).toBeNull();
    // 空状态里的主按钮同样不带图标
    const empty = buttons().find(
      (b) =>
        b !== title && b.textContent?.includes("从剧本拆分镜") && !b.getAttribute("aria-label"),
    );
    expect(empty).toBeTruthy();
    expect(empty!.querySelector("svg")).toBeNull();
    await m.unmount();
  });

  test("拆分中按钮换成转圈的图标，给出进行中的反馈", async () => {
    const d = deferred();
    impl = () => d.promise;
    const m = await mount(<Harness />);
    await dom.flush();
    await dom.click(splitButton());
    await dom.flush();
    const busy = buttons().find((b) => b.getAttribute("aria-label") === "拆分中");
    expect(busy?.querySelector("svg")).not.toBeNull();
    d.resolve(reply("甲"));
    await dom.flush();
    await m.unmount();
  });
});

describe("双击不能冒泡到画布（否则会弹出「添加节点」菜单）", () => {
  /** 在画布外层放一个双击监听，等同画布的 onDoubleClick；点中弹窗里的东西后它不该收到 */
  const withCanvasListener = async (shots: StoryboardShot[]) => {
    const spy = mock(() => {});
    const m = await mount(
      <div onDoubleClick={spy}>
        <Harness shots={shots} />
      </div>,
    );
    await dom.flush();
    return { spy, m };
  };
  const dblclick = (el: Element | null) =>
    dom.act(async () => {
      el?.dispatchEvent(new dom.win.MouseEvent("dblclick", { bubbles: true }));
    });

  test("双击弹窗里的文本框、表头、标题栏都不触发画布的双击", async () => {
    const { spy, m } = await withCanvasListener([shot("a", "旧一")]);
    await dblclick(body().querySelector('[aria-label="第 1 镜的画面描述"]'));
    await dblclick(body().querySelector('[data-slot="dialog-content"]'));
    await dblclick(buttons().find((b) => b.getAttribute("aria-label") === "从剧本拆分镜") ?? null);
    expect(spy).not.toHaveBeenCalled();
    await m.unmount();
  });

  test("双击覆盖确认框也不触发画布的双击", async () => {
    const { spy, m } = await withCanvasListener([shot("a", "旧一")]);
    await dom.click(splitButton());
    await dom.flush();
    await dblclick(body().querySelector('[data-slot="alert-dialog-content"]'));
    expect(spy).not.toHaveBeenCalled();
    await m.unmount();
  });
});

describe("拆分结果写回", () => {
  test("多个剧本按连线先后拼接成一份正文，选的模型一起带上", async () => {
    useSplit.getState().setModel("agent-a");
    const m = await mount(<Harness scripts={["第一段", "第二段"]} />);
    await dom.flush();
    await dom.click(splitButton());
    await dom.flush();
    expect(calls[0]).toEqual({ node_id: "sb", script: "第一段\n\n第二段", model: "agent-a" });
    await m.unmount();
  });

  test("镜头在前端分配 id，字段原样；新行被标记高亮，状态回到空闲", async () => {
    impl = async () => reply("甲", "乙");
    const m = await mount(<Harness />);
    await dom.flush();
    await dom.click(splitButton());
    await dom.flush();
    const shots = latest();
    expect(shots).toHaveLength(2);
    expect(new Set(shots.map((s) => s.id)).size).toBe(2);
    expect(shots[0]).toMatchObject({ scene: "甲", shot: "近景", camera: "推", duration: 4 });
    expect(useSplit.getState().stateOf("sb").phase).toBe("idle");
    expect(useSplit.getState().highlights["sb"]?.size).toBe(2);
    await m.unmount();
  });
});

describe("覆盖 / 追加 / 取消（AC3）", () => {
  const open = async () => {
    const m = await mount(<Harness shots={[shot("a", "旧一"), shot("b", "旧二")]} />);
    await dom.flush();
    await dom.click(splitButton());
    await dom.flush();
    return m;
  };

  test("表里已有镜头：先弹确认框，标题给出现状数字，此时不调模型", async () => {
    const m = await open();
    expect(body().textContent).toContain("分镜表里已有 2 个镜头");
    expect(calls).toHaveLength(0);
    await m.unmount();
  });

  test("追加到末尾：旧镜头原样在前，新镜头接在后面", async () => {
    impl = async () => reply("新一", "新二", "新三");
    const m = await open();
    await dom.click(buttonByText("追加到末尾"));
    await dom.flush();
    expect(latest().map((s) => s.scene)).toEqual(["旧一", "旧二", "新一", "新二", "新三"]);
    expect(latest()[0].id).toBe("a");
    await m.unmount();
  });

  test("覆盖：整表换成新镜头", async () => {
    impl = async () => reply("新一");
    const m = await open();
    await dom.click(buttonByText("覆盖"));
    await dom.flush();
    expect(latest().map((s) => s.scene)).toEqual(["新一"]);
    await m.unmount();
  });

  test("取消：不调模型，表格不变", async () => {
    const m = await open();
    await dom.click(buttonByText("取消"));
    await dom.flush();
    expect(calls).toHaveLength(0);
    expect(latest().map((s) => s.scene)).toEqual(["旧一", "旧二"]);
    expect(useSplit.getState().overwrite).toBeNull();
    await m.unmount();
  });
});

describe("拆分中", () => {
  test("显示进度条、表格锁住不能编辑、按钮变成「拆分中」且不可再点（追加模式末尾出骨架）", async () => {
    const d = deferred();
    impl = () => d.promise;
    const m = await mount(<Harness shots={[shot("a", "旧一")]} />);
    await dom.flush();
    await dom.click(splitButton());
    await dom.click(buttonByText("追加到末尾"));
    await dom.flush();
    expect(body().querySelector('[role="progressbar"]')).not.toBeNull();
    expect(body().querySelector("[inert]")).not.toBeNull();
    expect(body().querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    const busy = buttonByText("拆分中");
    expect(busy?.disabled).toBe(true);
    d.resolve(reply("新一"));
    await dom.flush();
    expect(body().querySelector('[role="progressbar"]')).toBeNull();
    expect(body().querySelector("[inert]")).toBeNull();
    expect(latest().map((s) => s.scene)).toEqual(["旧一", "新一"]);
    await m.unmount();
  });

  test("空表拆分中：显示「正在拆分镜」和骨架行", async () => {
    const d = deferred();
    impl = () => d.promise;
    const m = await mount(<Harness />);
    await dom.flush();
    await dom.click(splitButton());
    await dom.flush();
    expect(body().textContent).toContain("正在拆分镜");
    expect(body().querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    d.resolve(reply("甲"));
    await dom.flush();
    await m.unmount();
  });
});

describe("拆分失败（AC2 的失败路径）", () => {
  test("表格保持原样，横幅说明原因；点重试沿用同样的模式再试一次，成功后横幅消失", async () => {
    impl = async () => {
      throw new ApiErrorCtor("文本模型调用失败：rate limited", 30016, 502);
    };
    const m = await mount(<Harness shots={[shot("a", "旧一")]} />);
    await dom.flush();
    await dom.click(splitButton());
    await dom.click(buttonByText("覆盖"));
    await dom.flush();
    expect(body().querySelector('[role="alert"]')?.textContent).toContain(
      "拆分镜失败：文本模型调用失败：rate limited",
    );
    expect(latest().map((s) => s.scene)).toEqual(["旧一"]);

    impl = async () => reply("重试成功");
    await dom.click(buttonByText("重试"));
    await dom.flush();
    expect(calls).toHaveLength(2);
    expect(body().querySelector('[role="alert"]')).toBeNull();
    // 第一次选的是覆盖，重试也是覆盖
    expect(latest().map((s) => s.scene)).toEqual(["重试成功"]);
    await m.unmount();
  });

  test("横幅可以手动关掉", async () => {
    impl = async () => {
      throw new ApiErrorCtor("积分不足", 40001, 402);
    };
    const m = await mount(<Harness />);
    await dom.flush();
    await dom.click(splitButton());
    await dom.flush();
    expect(body().querySelector('[role="alert"]')).not.toBeNull();
    await dom.click(body().querySelector<HTMLButtonElement>('[role="alert"] [aria-label="关闭"]'));
    expect(body().querySelector('[role="alert"]')).toBeNull();
    await m.unmount();
  });
});
