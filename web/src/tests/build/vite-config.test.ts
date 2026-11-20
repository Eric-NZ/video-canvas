import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import viteConfig from "../../../vite.config";

/** 路由文件里所有 `path: "xxx"` 的首段（去掉前导斜杠，跳过 :id 这类参数） */
function routeFirstSegments(): Set<string> {
  const source = readFileSync(join(import.meta.dir, "../../router/index.tsx"), "utf8");
  const segments = new Set<string>();
  for (const match of source.matchAll(/path:\s*"([^"]+)"/g)) {
    const first = match[1].replace(/^\//, "").split("/")[0];
    if (first && !first.startsWith(":")) segments.add(first);
  }
  return segments;
}

describe("vite 构建产物目录", () => {
  test("不和前端路由重名：刷新 /assets 不能被 nginx 当成静态目录返回 403", () => {
    const assetsDir = viteConfig.build?.assetsDir ?? "assets";
    const routes = routeFirstSegments();
    // 先确认读到了路由，避免正则失效后空集合让断言白过
    expect(routes.has("assets")).toBe(true);
    expect(routes.has(assetsDir)).toBe(false);
  });

  test("不占用 nginx 转给后端的路径", () => {
    const assetsDir = viteConfig.build?.assetsDir ?? "assets";
    expect(["api", "files"]).not.toContain(assetsDir);
  });
});
