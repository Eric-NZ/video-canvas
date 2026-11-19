import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { EpisodeSummary } from "@/api/drama/type";
import type { BoardArea as BoardAreaType } from "@/pages/drama/workspace/board-area";
import type { DramaWorkspaceContext as ContextType } from "@/pages/drama/workspace/context";
import type { DramaWorkspace } from "@/pages/drama/workspace/use-workspace";
import { installDom, type DomEnv } from "@/tests/helpers/dom";

/** 故事板页的入口：分镜还没有时引导去片场，分镜生成中时等待（这两种都不打开画布） */

let dom: DomEnv;
let BoardArea: typeof BoardAreaType;
let Context: typeof ContextType;
beforeAll(async () => {
  dom = await installDom();
  BoardArea = (await import("@/pages/drama/workspace/board-area")).BoardArea;
  Context = (await import("@/pages/drama/workspace/context")).DramaWorkspaceContext;
}, 60_000);
afterAll(() => dom?.restore());

async function render(ep: Partial<EpisodeSummary>, onGo: (stage: string, no?: number) => void) {
  return dom.mount(
    <Context.Provider
      value={
        {
          drama: { id: "d1", episodes: [{ no: 1, title: "相识", ...ep }] },
        } as unknown as DramaWorkspace
      }
    >
      <BoardArea ep={1} onGo={onGo} />
    </Context.Provider>,
  );
}

describe("故事板页的入口", () => {
  test("这一集还没有分镜：引导去片场生成分镜", async () => {
    const went: Array<[string, number | undefined]> = [];
    const view = await render({ storyboardStatus: "empty" }, (stage, no) => went.push([stage, no]));
    expect(view.container.textContent).toContain("这一集还没有分镜");
    const go = [...view.container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("去片场"),
    );
    await dom.click(go);
    expect(went).toEqual([["studio", 1]]);
    await view.unmount();
  });

  test("分镜生成中：只显示等待，不给按钮", async () => {
    const view = await render({ storyboardStatus: "generating" }, () => {});
    expect(view.container.textContent).toContain("分镜生成中");
    expect(view.container.querySelector("button")).toBeNull();
    await view.unmount();
  });
});
