import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";

import type { AdminPresetGroup } from "@/api/admin/drama-prompt-preset";
import type DramaPresetsPageType from "@/pages/admin/drama-prompt-presets";
import { installDom, type DomEnv } from "@/tests/helpers/dom";
import service from "@/utils/requests/service";

let dom: DomEnv;
let DramaPresetsPage: typeof DramaPresetsPageType;
beforeAll(async () => {
  dom = await installDom();
  DramaPresetsPage = (await import("@/pages/admin/drama-prompt-presets")).default;
});
afterAll(() => dom.restore());

const row = {
  id: "a",
  name: "标准版",
  description: "原内置",
  body: "当前正文",
  revision: 2,
  status: "enabled",
  updated_at: "2026-11-25T00:00:00Z",
} as const;

test("后台保护默认项，并可复制原内置为停用模板", async () => {
  const groups: AdminPresetGroup[] = [
    { step: "plan", revision: 1, default_id: "a", original_body: "升级前的正文", items: [row] },
  ];
  const read = spyOn(service, "get").mockResolvedValue({ items: groups } as never);
  const create = spyOn(service, "post").mockResolvedValue({
    ...row,
    id: "b",
    status: "disabled",
  } as never);
  const mounted = await dom.mount(<DramaPresetsPage />);
  try {
    await dom.flush();
    expect(mounted.container.textContent).toContain("短剧提示词");
    expect(mounted.container.textContent).not.toContain("管理开拍设置里的内置提示词");
    const action = (root: ParentNode, text: string) =>
      [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === text);
    const defaultRow = mounted.container.querySelector("tbody tr");
    expect(defaultRow?.textContent).toContain("默认");
    expect(action(defaultRow!, "停用")).toBeUndefined();
    expect(action(defaultRow!, "归档")).toBeUndefined();
    await dom.click(action(mounted.container, "复制原内置"));
    const popup = dom.win.document.body.querySelector('[data-slot="dialog-content"]')!;
    expect(popup.querySelector("textarea")?.value).toBe("升级前的正文");
    await dom.type(popup.querySelector("input")!, "原版备用");
    await dom.click(action(popup, "保存"));
    expect(create.mock.calls[0]).toMatchObject([
      "/admin/drama-prompt-presets/plan",
      { name: "原版备用", body: "升级前的正文" },
      { silent: true },
    ]);
  } finally {
    await mounted.unmount();
    create.mockRestore();
    read.mockRestore();
  }
});
