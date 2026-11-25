import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { DramaPresetAdminItem } from "@/api/admin/drama-preset/type";
import { installDom, type DomEnv } from "@/tests/helpers/dom";
import type { PresetGrid as PresetGridType } from "@/pages/admin/drama-presets/preset-grid";

/**
 * 短剧预设卡片墙：每张卡自带名称、key、引用数，末尾一格是新建；
 * 删除的可用性同时受「有没有短剧在用」和「是不是 super_admin」两条约束。
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
        canDelete
        onReorder={() => {}}
        onToggle={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
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

  test("被短剧引用的条目删不掉，原因写在 title 上；没用过的可以删", async () => {
    const m = await dom.mount(
      <PresetGrid
        items={[
          item({ id: 1, name: "在用", project_count: 2 }),
          item({ id: 2, key: "flat_2d", name: "没用过", project_count: 0 }),
        ]}
        kind="style"
        busyIds={new Set()}
        canDelete
        onReorder={() => {}}
        onToggle={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
        onNew={() => {}}
      />,
    );
    const used = m.container.querySelector<HTMLButtonElement>(
      '[aria-label=删除][title*="只能停用"]',
    );
    const free = m.container.querySelector<HTMLButtonElement>('[aria-label=删除][title="删除"]');
    expect(used?.disabled).toBe(true);
    expect(used?.title).toBe("已有 2 部短剧在用，只能停用");
    expect(free?.disabled).toBe(false);
    await m.unmount();
  });

  test("非 super_admin：删除一律禁用，换成权限原因", async () => {
    const m = await dom.mount(
      <PresetGrid
        items={[item({ project_count: 0 })]}
        kind="style"
        busyIds={new Set()}
        canDelete={false}
        onReorder={() => {}}
        onToggle={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
        onNew={() => {}}
      />,
    );
    const remove = m.container.querySelector<HTMLButtonElement>("[aria-label=删除]");
    expect(remove?.disabled).toBe(true);
    expect(remove?.title).toBe("只有超级管理员能删除预设");
    await m.unmount();
  });

  test("停用的卡打「已停用」标；点编辑、删除、新建各走各的回调", async () => {
    const seen: string[] = [];
    const m = await dom.mount(
      <PresetGrid
        items={[item({ id: 7, enabled: false, project_count: 0 })]}
        kind="style"
        busyIds={new Set()}
        canDelete
        onReorder={() => {}}
        onToggle={() => {}}
        onEdit={() => seen.push("edit")}
        onRemove={() => seen.push("remove")}
        onNew={() => seen.push("new")}
      />,
    );
    expect(m.container.textContent).toContain("已停用");

    m.container.querySelector<HTMLButtonElement>("[aria-label=编辑]")!.click();
    m.container.querySelector<HTMLButtonElement>("[aria-label=删除]")!.click();
    [...m.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent?.includes("新建画风"))!
      .click();
    expect(seen).toEqual(["edit", "remove", "new"]);
    await m.unmount();
  });
});
