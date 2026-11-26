import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { DramaPresetAdminItem } from "@/api/admin/drama-preset/type";
import { installDom, type DomEnv } from "@/tests/helpers/dom";
import type { PresetGrid as PresetGridType } from "@/pages/admin/drama-presets/preset-grid";

/**
 * 短剧预设卡片墙：每张卡自带名称、key、引用数，末尾一格是新建；
 * 卡片上只有编辑和启停，没有删除——预设下架靠停用，历史引用不能被切断。
 */

const item = (patch: Partial<DramaPresetAdminItem> = {}): DramaPresetAdminItem => ({
  id: 1,
  kind: "style",
  key: "anime_90s",
  name: "90年代日式动画",
  prompt: "以九十年代手绘赛璐璐动画呈现",
  preview_url: "/drama-styles/anime_90s.webp",
  sort_order: 0,
  enabled: true,
  is_builtin: true,
  project_count: 0,
  ...patch,
});

describe("短剧预设卡片墙", () => {
  let dom: DomEnv;
  let PresetGrid: typeof PresetGridType;
  beforeAll(async () => {
    dom = await installDom();
    PresetGrid = (await import("@/pages/admin/drama-presets/preset-grid")).PresetGrid;
  });
  afterAll(() => dom.restore());

  test("每张卡都带名称、key 与引用数，末尾一格是新建", async () => {
    const m = await dom.mount(
      <PresetGrid
        items={[
          item({ id: 1, key: "anime_90s", name: "90年代日式动画", project_count: 3 }),
          item({ id: 2, key: "flat_2d", name: "二维扁平设计", prompt: "", project_count: 0 }),
        ]}
        kind="style"
        busyIds={new Set()}
        onReorder={() => {}}
        onToggle={() => {}}
        onEdit={() => {}}
        onNew={() => {}}
      />,
    );
    const text = m.container.textContent ?? "";
    expect(text).toContain("90年代日式动画");
    expect(text).toContain("anime_90s");
    expect(text).toContain("3 部短剧在用");
    expect(text).toContain("二维扁平设计");
    expect(text).toContain("暂无短剧使用");
    expect(text).toContain("新建画风");
    expect(m.container.querySelectorAll("img").length).toBe(2);
    await m.unmount();
  });

  test("卡片上没有删除：不管有没有短剧在用，都只给编辑和启用开关", async () => {
    const m = await dom.mount(
      <PresetGrid
        items={[item({ id: 1, project_count: 5 }), item({ id: 2, key: "flat_2d", name: "没用过" })]}
        kind="style"
        busyIds={new Set()}
        onReorder={() => {}}
        onToggle={() => {}}
        onEdit={() => {}}
        onNew={() => {}}
      />,
    );
    expect(m.container.querySelector("[aria-label=删除]")).toBeNull();
    expect(m.container.querySelectorAll("[aria-label=编辑]").length).toBe(2);
    expect(m.container.querySelectorAll("[role=switch]").length).toBe(2);
    await m.unmount();
  });

  test("停用的卡打「已停用」标；点编辑、新建各走各的回调", async () => {
    const seen: string[] = [];
    const m = await dom.mount(
      <PresetGrid
        items={[item({ id: 7, enabled: false, project_count: 0 })]}
        kind="style"
        busyIds={new Set()}
        onReorder={() => {}}
        onToggle={() => {}}
        onEdit={() => seen.push("edit")}
        onNew={() => seen.push("new")}
      />,
    );
    expect(m.container.textContent).toContain("已停用");

    m.container.querySelector<HTMLButtonElement>("[aria-label=编辑]")!.click();
    [...m.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent?.includes("新建画风"))!
      .click();
    expect(seen).toEqual(["edit", "new"]);
    await m.unmount();
  });

  test("开关回调把整条预设交回去，由调用方按当前状态取反", async () => {
    const seen: number[] = [];
    const m = await dom.mount(
      <PresetGrid
        items={[item({ id: 9, enabled: true })]}
        kind="style"
        busyIds={new Set()}
        onReorder={() => {}}
        onToggle={(it) => seen.push(it.id)}
        onEdit={() => {}}
        onNew={() => {}}
      />,
    );
    m.container.querySelector<HTMLElement>("[role=switch]")!.click();
    expect(seen).toEqual([9]);
    await m.unmount();
  });
});
