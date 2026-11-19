import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { installDom, type DomEnv } from "@/tests/helpers/dom";
import type { useApplyCanvasFocus as HookType } from "@/hooks/use-apply-canvas-focus";
import type { CanvasEditorCommands } from "@/components/canvas-editor/editor-api";
import type { useCanvasFocusStore as StoreType } from "@/store/drama-canvas-focus";

/** 片场「进入画布查看」落到资产画布：等编辑器挂好、节点在了，再切到画布视图并飞过去 */

let dom: DomEnv;
let useApplyCanvasFocus: typeof HookType;
let useCanvasFocusStore: typeof StoreType;
beforeAll(async () => {
  dom = await installDom();
  useApplyCanvasFocus = (await import("@/hooks/use-apply-canvas-focus")).useApplyCanvasFocus;
  useCanvasFocusStore = (await import("@/store/drama-canvas-focus")).useCanvasFocusStore;
});
afterAll(() => dom.restore());
beforeEach(() => useCanvasFocusStore.setState({ byDrama: {} }));

const waitFrames = (ms = 80) => dom.flush(ms);

function mountHook(commands: { current: CanvasEditorCommands | null }, shown: string[]) {
  const focused: string[] = [];
  function Probe() {
    useApplyCanvasFocus("d1", commands, () => shown.push("canvas"));
    return null;
  }
  // 命令表的 focusNode 记下被飞到的节点
  const wrap = (nodes: string[]): CanvasEditorCommands =>
    ({
      getNodes: () => nodes.map((id) => ({ id })),
      focusNode: (id: string) => {
        focused.push(id);
        return true;
      },
    }) as unknown as CanvasEditorCommands;
  return { Probe, focused, wrap };
}

describe("useApplyCanvasFocus", () => {
  test("没有请求：什么都不做", async () => {
    const shown: string[] = [];
    const commands = { current: null as CanvasEditorCommands | null };
    const { Probe, focused, wrap } = mountHook(commands, shown);
    commands.current = wrap(["b1"]);
    const m = await dom.mount(<Probe />);
    await waitFrames();
    expect(shown).toEqual([]);
    expect(focused).toEqual([]);
    await m.unmount();
  });

  test("有请求且节点已在：切到画布视图并飞过去，请求被取走", async () => {
    const shown: string[] = [];
    const commands = { current: null as CanvasEditorCommands | null };
    const { Probe, focused, wrap } = mountHook(commands, shown);
    commands.current = wrap(["a", "b1"]);
    useCanvasFocusStore.getState().request("d1", "b1");
    const m = await dom.mount(<Probe />);
    await waitFrames();
    expect(shown).toEqual(["canvas"]);
    expect(focused).toEqual(["b1"]);
    expect(useCanvasFocusStore.getState().byDrama.d1).toBeUndefined();
    await m.unmount();
  });

  test("编辑器还没挂好：等它挂好再定位，不丢请求", async () => {
    const shown: string[] = [];
    const commands = { current: null as CanvasEditorCommands | null };
    const { Probe, focused, wrap } = mountHook(commands, shown);
    useCanvasFocusStore.getState().request("d1", "b1");
    const m = await dom.mount(<Probe />);
    await waitFrames(30);
    expect(shown).toEqual([]);
    expect(useCanvasFocusStore.getState().byDrama.d1).toBe("b1");
    commands.current = wrap(["b1"]);
    await waitFrames();
    expect(shown).toEqual(["canvas"]);
    expect(focused).toEqual(["b1"]);
    await m.unmount();
  });
});
