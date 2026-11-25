import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";

import type { BackendScriptEntityDto } from "@/api/drama/type";
import { installDom, type DomEnv } from "@/tests/helpers/dom";
import service from "@/utils/requests/service";

/** 人物页 / 地点页的卡片墙：直接读写剧本人物表、地点表，改完通知工作台刷新，剧本那边跟着同步。 */

let dom: DomEnv;
let EntityWall: typeof import("@/pages/drama/workspace/script-editor/entity-wall").EntityWall;
beforeAll(async () => {
  dom = await installDom();
  ({ EntityWall } = await import("@/pages/drama/workspace/script-editor/entity-wall"));
});
afterAll(async () => {
  await dom.flush(50);
  dom.restore();
});

type Row = { name: string; aliases: string[]; note: string; confirmed: boolean };
let rows: Record<string, Row>;
const dto = (id: string): BackendScriptEntityDto => ({
  id,
  name: rows[id].name,
  aliases: rows[id].aliases,
  note: rows[id].note,
  canvas_node_id: "",
  confirmed: rows[id].confirmed,
  episodes: [1],
  lines: 3,
});

let get: ReturnType<typeof spyOn<typeof service, "get">>;
let patch: ReturnType<typeof spyOn<typeof service, "patch">>;
let post: ReturnType<typeof spyOn<typeof service, "post">>;
beforeEach(() => {
  rows = {
    c1: { name: "闰土", aliases: ["少年闰土"], note: "忙月的儿子。", confirmed: true },
    c2: { name: "迅哥儿", aliases: [], note: "", confirmed: false },
  };
  get = spyOn(service, "get").mockImplementation((async () => Object.keys(rows).map(dto)) as never);
  patch = spyOn(service, "patch").mockImplementation((async (url: string, body: Partial<Row>) => {
    const id = url.split("/").pop() as string;
    Object.assign(rows[id], body);
    return dto(id);
  }) as never);
  post = spyOn(service, "post").mockImplementation((async (
    _url: string,
    body: { name: string },
  ) => {
    rows.c3 = { name: body.name, aliases: [], note: "", confirmed: true };
    return dto("c3");
  }) as never);
});
afterEach(() => {
  get.mockRestore();
  patch.mockRestore();
  post.mockRestore();
});

async function until(check: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("等待超时");
    await dom.flush(20);
  }
}
const card = (c: HTMLElement, name: string) =>
  [...c.querySelectorAll<HTMLElement>("[data-entity]")].find(
    (el) => el.querySelector<HTMLInputElement>("input[aria-label=名字]")?.value === name,
  )!;
const key = (el: Element, k: string) =>
  el.dispatchEvent(new dom.win.KeyboardEvent("keydown", { key: k, bubbles: true }));

describe("人物卡片墙", () => {
  test("一人一张卡：名字、别名、小传、待确认；没有资产图时图位显示首字", async () => {
    const m = await dom.mount(<EntityWall dramaId="1a2b" kind="character" />);
    await until(() => m.container.querySelectorAll("[data-entity]").length === 2);
    const c1 = card(m.container, "闰土");
    expect(c1.textContent).toContain("少年闰土");
    expect(c1.querySelector("textarea")?.value).toBe("忙月的儿子。");
    expect(c1.querySelector("[data-slot-initial]")?.textContent).toBe("闰");
    expect(card(m.container, "迅哥儿").textContent).toContain("待确认");
    await m.unmount();
  });

  test("改名、加别名、改小传都写回人物表，并通知工作台刷新", async () => {
    let changed = 0;
    const m = await dom.mount(
      <EntityWall dramaId="1a2b" kind="character" onChanged={() => changed++} />,
    );
    await until(() => m.container.querySelectorAll("[data-entity]").length === 2);
    const name = card(m.container, "迅哥儿").querySelector<HTMLInputElement>(
      "input[aria-label=名字]",
    )!;
    await dom.type(name, "少年迅哥儿");
    key(name, "Enter");
    await until(() => rows.c2.name === "少年迅哥儿");
    expect(patch.mock.calls[0][0]).toBe("/dramas/1a2b/script-characters/c2");

    const c1 = card(m.container, "闰土");
    await dom.click(c1.querySelector<HTMLButtonElement>("[data-add-alias]"));
    const alias = c1.querySelector<HTMLInputElement>("input[aria-label=新别名]")!;
    await dom.type(alias, "水生的爹");
    key(alias, "Enter");
    await until(() => rows.c1.aliases.includes("水生的爹"));
    expect(rows.c1.aliases).toEqual(["少年闰土", "水生的爹"]);

    const note = card(m.container, "闰土").querySelector("textarea")!;
    await dom.type(note, "忙月的儿子，来自海边沙地。");
    note.dispatchEvent(new dom.win.FocusEvent("focusout", { bubbles: true }));
    await until(() => rows.c1.note === "忙月的儿子，来自海边沙地。");
    // 每次写完都重读表并通知工作台刷新
    await until(() => changed >= 3);
    await m.unmount();
  });

  test("新增人物：点新增出一张空卡，写名字回车就建好", async () => {
    const m = await dom.mount(<EntityWall dramaId="1a2b" kind="character" />);
    await until(() => m.container.querySelectorAll("[data-entity]").length === 2);
    await dom.click(m.container.querySelector<HTMLButtonElement>("[data-new-entity]"));
    const input = await (async () => {
      let el: HTMLInputElement | null = null;
      await until(() => !!(el = m.container.querySelector("input[aria-label=新人物的名字]")));
      return el!;
    })();
    await dom.type(input, "迅哥儿的父亲");
    key(input, "Enter");
    await until(() => !!card(m.container, "迅哥儿的父亲"));
    expect(post.mock.calls[0][0]).toBe("/dramas/1a2b/script-characters");
    await m.unmount();
  });
});
