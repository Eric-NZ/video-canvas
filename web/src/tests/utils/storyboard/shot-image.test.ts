import { describe, expect, test } from "bun:test";

import type { StoryboardShot } from "@/types";
import { shotImageState } from "@/utils/storyboard/shot-image";
import type { VideoNodeView } from "@/utils/tasks/node-view";

const shot = (patch: Partial<StoryboardShot> = {}): StoryboardShot => ({
  id: "a",
  scene: "画面",
  shot: "中景",
  camera: "固定",
  action: "",
  dialogue: "",
  duration: 3,
  ...patch,
});

const view = (v: VideoNodeView) => ({ exists: true as const, view: v });
const MISSING = { exists: false as const };

describe("分镜图格的状态（设计 §6.5 的 6 种）", () => {
  test("没有任何来源：空，可生成可上传", () => {
    expect(shotImageState(shot(), undefined)).toEqual({ kind: "empty" });
  });

  test("关联的图片节点已经被删掉：回到空，按钮恢复成「生成分镜图」（AC8）", () => {
    expect(shotImageState(shot({ imageNodeId: "i1" }), MISSING)).toEqual({ kind: "empty" });
  });

  test("手动上传的图：显示它，不带节点角标（AC9）", () => {
    expect(shotImageState(shot({ image: { assetId: "9", src: "/f/9.png" } }), undefined)).toEqual({
      kind: "uploaded",
      src: "/f/9.png",
    });
  });

  test("关联节点：排队中、生成中（带进度）、即将完成", () => {
    expect(shotImageState(shot({ imageNodeId: "i1" }), view({ phase: "queued" }))).toEqual({
      kind: "node",
      phase: "queued",
    });
    expect(
      shotImageState(
        shot({ imageNodeId: "i1" }),
        view({ phase: "running", elapsedMs: 1000, progress: 42 }),
      ),
    ).toEqual({ kind: "node", phase: "running", progress: 42 });
    expect(shotImageState(shot({ imageNodeId: "i1" }), view({ phase: "finalizing" }))).toEqual({
      kind: "node",
      phase: "running",
      progress: null,
    });
  });

  test("关联节点生成完：实时显示它当前的图", () => {
    expect(
      shotImageState(shot({ imageNodeId: "i1" }), view({ phase: "done", src: "/f/new.png" })),
    ).toEqual({ kind: "node", phase: "done", src: "/f/new.png" });
  });

  test("关联节点生成失败：带原因", () => {
    expect(
      shotImageState(
        shot({ imageNodeId: "i1" }),
        view({ phase: "failed", message: "积分不足", refunded: true, taskRef: null }),
      ),
    ).toEqual({ kind: "node", phase: "failed", message: "积分不足" });
  });

  test("节点建好了还没生成（模型没准备好等）：未生成，但能定位过去", () => {
    expect(shotImageState(shot({ imageNodeId: "i1" }), view({ phase: "idle" }))).toEqual({
      kind: "node",
      phase: "idle",
    });
  });

  test("上传中的节点（节点是本地传图进来的）按未生成处理，不当成生成进度", () => {
    expect(
      shotImageState(shot({ imageNodeId: "i1" }), view({ phase: "uploading", progress: 30 })),
    ).toEqual({ kind: "node", phase: "idle" });
  });
});
