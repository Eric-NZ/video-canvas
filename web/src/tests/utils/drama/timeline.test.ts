import { describe, expect, test } from "bun:test";

import type { AssetDto } from "@/api/asset/type";
import type { Segment, Timeline, TimelineClip } from "@/api/drama/type";
import {
  changeText,
  clipAt,
  composeReason,
  defaultTimeline,
  insertClip,
  insertIndexAt,
  moveClip,
  removeClip,
  resolveClip,
  restoreLength,
  splitAt,
  swapTake,
  totalMs,
  trimEdge,
  trimToPlayhead,
} from "@/utils/drama/timeline";

const asset = (id: string, kind: "video" | "image", durationMs: number | null): AssetDto => ({
  id,
  url: `/files/${id}`,
  kind,
  mimeType: "",
  byteSize: 1,
  width: null,
  height: null,
  durationMs,
  fileName: `${id}.${kind === "video" ? "mp4" : "png"}`,
});

const take = (
  taskId: string,
  durationMs: number,
  status: "succeeded" | "failed" = "succeeded",
) => ({
  taskId,
  status,
  asset: status === "succeeded" ? asset(`a${taskId}`, "video", durationMs) : null,
  errorMessage: "",
  createdAt: "",
});

/** 片段 01 有 t1（15 秒）、t2（12 秒），采用 t1；片段 02 没有采用 */
const segments: Segment[] = [
  {
    id: "s1",
    episodeNo: 1,
    seq: 0,
    seconds: 15,
    prompt: "",
    takes: [take("t1", 15000), take("t2", 12000), take("t3", 0, "failed")],
    chosenTaskId: "t1",
    status: "done",
    revision: 1,
    updatedAt: "",
    adaptations: {},
  } as unknown as Segment,
  {
    id: "s2",
    episodeNo: 1,
    seq: 1,
    seconds: 10,
    prompt: "",
    takes: [],
    chosenTaskId: "",
    status: "idle",
    revision: 1,
    updatedAt: "",
    adaptations: {},
  } as unknown as Segment,
];

const seg = (
  id: string,
  segmentId: string,
  taskId: string,
  inMs: number,
  outMs: number,
): TimelineClip => ({
  id,
  kind: "segment",
  segmentId,
  taskId,
  pinned: false,
  assetId: "",
  media: null,
  inMs,
  outMs,
  muted: false,
});

const image = (id: string, assetId: string, outMs: number): TimelineClip => ({
  id,
  kind: "asset",
  segmentId: "",
  taskId: "",
  pinned: false,
  assetId,
  media: "image",
  inMs: 0,
  outMs,
  muted: false,
});

const assets = new Map([["i1", asset("i1", "image", null)]]);

describe("时间线计算", () => {
  const clips = [
    seg("a", "s1", "t1", 2000, 12000),
    image("x", "i1", 3000),
    seg("b", "s2", "", 0, 10000),
  ];

  test("总长与按时间找段", () => {
    expect(totalMs(clips)).toBe(23000);
    expect(clipAt(clips, 0)).toEqual({ index: 0, offset: 0 });
    expect(clipAt(clips, 11500)).toEqual({ index: 1, offset: 1500 });
    expect(clipAt(clips, 23000)).toBeNull();
  });

  test("插入点取最近的段边界", () => {
    expect(insertIndexAt(clips, 1000)).toBe(0);
    expect(insertIndexAt(clips, 9000)).toBe(1);
    expect(insertIndexAt(clips, 22000)).toBe(3);
  });

  test("默认时间线：按序号、全长、跟随", () => {
    const t = defaultTimeline([...segments].reverse());
    expect(t.clips.map((c) => [c.segmentId, c.taskId, c.inMs, c.outMs])).toEqual([
      ["s1", "t1", 0, 15000],
      ["s2", "", 0, 10000],
    ]);
  });
});

describe("解析段的来源", () => {
  test("跟随段、占位、失效、图片", () => {
    const invalid = new Set<string>();
    expect(resolveClip(seg("a", "s1", "t2", 0, 1000), segments, assets, invalid)).toMatchObject({
      kind: "video",
      url: "/files/at2",
      durationMs: 12000,
      label: "片段 01",
      version: 2,
    });
    expect(resolveClip(seg("b", "s2", "", 0, 1000), segments, assets, invalid)).toMatchObject({
      kind: "placeholder",
      durationMs: 10000,
      label: "片段 02",
    });
    expect(resolveClip(seg("c", "s1", "t3", 0, 1000), segments, assets, invalid).kind).toBe(
      "broken",
    );
    expect(resolveClip(seg("d", "s9", "t1", 0, 1000), segments, assets, invalid).kind).toBe(
      "broken",
    );
    expect(resolveClip(image("x", "i1", 3000), segments, assets, invalid)).toMatchObject({
      kind: "image",
      label: "i1.png",
    });
    expect(resolveClip(image("y", "i9", 3000), segments, assets, invalid).kind).toBe("broken");
    expect(resolveClip(seg("a", "s1", "t1", 0, 1000), segments, assets, new Set(["a"])).kind).toBe(
      "broken",
    );
  });
});

describe("编辑操作", () => {
  test("拆分视频段和图片段，占位和贴边不能拆", () => {
    const clips = [
      seg("a", "s1", "t1", 2000, 12000),
      image("x", "i1", 3000),
      seg("b", "s2", "", 0, 10000),
    ];
    const video = splitAt(clips, 5000, () => "n1");
    expect("clips" in video && video.clips.slice(0, 2).map((c) => [c.id, c.inMs, c.outMs])).toEqual(
      [
        ["a", 2000, 7000],
        ["n1", 7000, 12000],
      ],
    );
    const img = splitAt(clips, 11000, () => "n2");
    expect("clips" in img && img.clips.slice(1, 3).map((c) => [c.id, c.inMs, c.outMs])).toEqual([
      ["x", 0, 1000],
      ["n2", 0, 2000],
    ]);
    expect(splitAt(clips, 15000, () => "n")).toEqual({ error: "待采用的片段不能拆分" });
    expect(splitAt(clips, 200, () => "n")).toEqual({ error: "离段边缘太近（每段至少 0.5 秒）" });
  });

  test("裁到播放头：向左删前面、向右删后面", () => {
    const clips = [seg("a", "s1", "t1", 2000, 12000), image("x", "i1", 3000)];
    const left = trimToPlayhead(clips, 0, 4000, "left");
    expect("clips" in left && [left.clips[0].inMs, left.clips[0].outMs, left.playhead]).toEqual([
      6000, 12000, 0,
    ]);
    const right = trimToPlayhead(clips, 1, 11000, "right");
    expect("clips" in right && [right.clips[1].inMs, right.clips[1].outMs]).toEqual([0, 1000]);
    expect(trimToPlayhead(clips, 0, 9800, "right")).toMatchObject({ clips: expect.any(Array) });
    expect(trimToPlayhead(clips, 0, 9900, "left")).toEqual({
      error: "裁完不足 0.5 秒，请改用删除",
    });
    expect(trimToPlayhead(clips, 1, 2000, "left")).toEqual({ error: "播放头要落在这一段中间" });
  });

  test("拖边：不超出素材、不短于 0.5 秒；图片两边都改时长", () => {
    const v = seg("a", "s1", "t1", 2000, 12000);
    expect(trimEdge(v, "start", -5000, 15000)).toMatchObject({ inMs: 0, outMs: 12000 });
    expect(trimEdge(v, "start", 20000, 15000)).toMatchObject({ inMs: 11500, outMs: 12000 });
    expect(trimEdge(v, "end", 9000, 15000)).toMatchObject({ inMs: 2000, outMs: 15000 });
    const i = image("x", "i1", 3000);
    expect(trimEdge(i, "start", 1000, 30000)).toMatchObject({ inMs: 0, outMs: 2000 });
    expect(trimEdge(i, "end", 40000, 30000)).toMatchObject({ inMs: 0, outMs: 30000 });
  });

  test("删除片段段记入删除名单，插回时移出", () => {
    const t: Timeline = {
      clips: [seg("a", "s1", "t1", 0, 15000), seg("b", "s2", "", 0, 10000)],
      muted: false,
      removedSegmentIds: [],
      imports: [],
    };
    const removed = removeClip(t, "b");
    expect(removed.clips.map((c) => c.id)).toEqual(["a"]);
    expect(removed.removedSegmentIds).toEqual(["s2"]);
    const back = insertClip(removed, 0, seg("c", "s2", "", 0, 10000));
    expect(back.clips.map((c) => c.id)).toEqual(["c", "a"]);
    expect(back.removedSegmentIds).toEqual([]);
    // 拆过的片段删掉一段，另一段还在：不进删除名单
    const split: Timeline = {
      ...t,
      clips: [seg("a", "s1", "t1", 0, 5000), seg("a2", "s1", "t1", 5000, 15000)],
    };
    expect(removeClip(split, "a").removedSegmentIds).toEqual([]);
  });

  test("移动：插入点是移走之前的位置", () => {
    const clips = [
      seg("a", "s1", "t1", 0, 1000),
      seg("b", "s1", "t1", 0, 1000),
      seg("c", "s1", "t1", 0, 1000),
    ];
    expect(moveClip(clips, 0, 3).map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(moveClip(clips, 2, 0).map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(moveClip(clips, 1, 2)).toBe(clips);
  });

  test("换版本：固定版本保留入出点并收回；跟随采用恢复不固定", () => {
    const a = seg("a", "s1", "t1", 2000, 14000);
    expect(swapTake(a, segments[0], "t2")).toMatchObject({
      taskId: "t2",
      pinned: true,
      inMs: 2000,
      outMs: 12000,
    });
    expect(swapTake({ ...a, taskId: "t2", pinned: true }, segments[0], "follow")).toMatchObject({
      taskId: "t1",
      pinned: false,
    });
    expect(swapTake({ ...a, inMs: 11800 }, segments[0], "t2")).toMatchObject({
      inMs: 0,
      outMs: 12000,
    });
  });

  test("恢复原长", () => {
    expect(restoreLength(seg("a", "s1", "t1", 2000, 9000), 15000)).toMatchObject({
      inMs: 0,
      outMs: 15000,
    });
    expect(restoreLength(image("x", "i1", 8000), 30000)).toMatchObject({ inMs: 0, outMs: 3000 });
  });
});

describe("合成前检查与同步文案", () => {
  test("合成按钮的禁用原因", () => {
    const t: Timeline = {
      clips: [seg("a", "s1", "t1", 0, 15000)],
      muted: false,
      removedSegmentIds: [],
      imports: [],
    };
    const ok = {
      timeline: t,
      segments,
      assets,
      invalid: new Set<string>(),
      save: "saved" as const,
    };
    expect(composeReason(ok)).toBeNull();
    expect(composeReason({ ...ok, save: "error" })).toBe("时间线没保存成功，先重试保存");
    expect(composeReason({ ...ok, invalid: new Set(["a"]) })).toBe(
      "第 1 段的素材已失效，请换版本或删掉",
    );
    expect(
      composeReason({ ...ok, timeline: { ...t, clips: [seg("b", "s2", "", 0, 10000)] } }),
    ).toBe("至少要有一段可用的视频或图片才能合成");
  });

  test("同步变化的文案", () => {
    expect(
      changeText(
        { kind: "swapped", segmentId: "s1", seq: 0, clipId: "a" },
        segments,
        seg("a", "s1", "t2", 0, 1),
      ),
    ).toBe("片段 01 换成了采用的版本 2");
    expect(
      changeText(
        { kind: "added", segmentId: "s2", seq: 1, clipId: "b" },
        segments,
        seg("b", "s2", "", 0, 1),
      ),
    ).toBe("新增片段 02（待采用）");
    expect(
      changeText({ kind: "removed", segmentId: "s9", seq: 2, clipId: "" }, segments, null),
    ).toBe("片段 03 已删除，已从时间线移除");
    expect(
      changeText({ kind: "unadopted", segmentId: "s1", seq: 0, clipId: "a" }, segments, null),
    ).toBe("片段 01 取消了采用，变成待采用");
    expect(
      changeText(
        { kind: "adopted", segmentId: "s1", seq: 0, clipId: "a" },
        segments,
        seg("a", "s1", "t1", 0, 1),
      ),
    ).toBe("片段 01 已采用版本 1");
  });
});
