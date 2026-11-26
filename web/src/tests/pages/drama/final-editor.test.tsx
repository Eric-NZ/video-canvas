import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { Segment, TimelineClip } from "@/api/drama/type";
import { FinalBar } from "@/pages/drama/workspace/final/final-bar";
import { TimelineTrack, type TrackActions } from "@/pages/drama/workspace/final/timeline-track";
import type { TimelinePlayer } from "@/pages/drama/workspace/final/use-timeline-player";
import type { ClipSource } from "@/utils/drama/timeline";

const segment = (id: string, seq: number): Segment =>
  ({
    id,
    episodeNo: 1,
    seq,
    seconds: 15,
    prompt: "",
    takes: [],
    chosenTaskId: "",
    status: "idle",
    revision: 1,
    updatedAt: "",
    adaptations: {},
  }) as unknown as Segment;

const clip = (id: string, over: Partial<TimelineClip> = {}): TimelineClip => ({
  id,
  kind: "segment",
  segmentId: "s1",
  taskId: "t1",
  pinned: false,
  assetId: "",
  media: null,
  inMs: 0,
  outMs: 15000,
  muted: false,
  ...over,
});

const noop = () => {};

const barProps = {
  no: 1,
  title: "湖底沉箱",
  state: "none" as const,
  save: "saved" as const,
  sync: [],
  segments: [segment("s1", 0), segment("s2", 1)],
  adopted: 1,
  timelineMs: 89_000,
  running: null,
  composing: false,
  composeReason: null,
  hasFinal: false,
  saving: false,
  readOnly: false,
  onRetrySave: noop,
  onLocate: noop,
  onAckSync: noop,
  onUndoSync: noop,
  onDownload: noop,
  onCompose: noop,
};

describe("成片顶栏", () => {
  test("标题、统计和合成按钮", () => {
    const html = renderToStaticMarkup(<FinalBar {...barProps} />);
    expect(html).toContain("第 1 集 · 湖底沉箱");
    expect(html).toContain("1/2");
    expect(html).toContain("01:29");
    expect(html).toContain("合成第 1 集");
    expect(html).not.toContain("片场更新");
  });

  test("有同步变化时出现「片场更新 N」胶囊，不出横幅", () => {
    const html = renderToStaticMarkup(
      <FinalBar
        {...barProps}
        sync={[
          {
            change: { kind: "added", segmentId: "s2", seq: 1, clipId: "n1" },
            clip: clip("n1", { segmentId: "s2", taskId: "" }),
          },
          { change: { kind: "removed", segmentId: "s9", seq: 2, clipId: "" }, clip: null },
        ]}
      />,
    );
    expect(html).toContain("片场更新 2");
  });

  test("不能合成时按钮禁用并写明原因；成片过期显示提示", () => {
    const html = renderToStaticMarkup(
      <FinalBar
        {...barProps}
        state="stale"
        hasFinal
        composeReason="第 2 段的素材已失效，请换版本或删掉"
      />,
    );
    expect(html).toContain("成片已过期，可重新合成");
    expect(html).toContain("重新合成");
    expect(html).toContain("第 2 段的素材已失效，请换版本或删掉");
    expect(html).toContain("disabled");
    expect(html).toContain("下载 mp4");
  });

  test("保存失败给出重试；只读时不出合成按钮", () => {
    expect(renderToStaticMarkup(<FinalBar {...barProps} save="error" />)).toContain(
      "时间线保存失败 · 重试",
    );
    expect(renderToStaticMarkup(<FinalBar {...barProps} readOnly />)).not.toContain("合成第 1 集");
  });
});

describe("时间线轨道", () => {
  const player: TimelinePlayer = {
    playing: false,
    index: 0,
    activeSlot: 0,
    total: 0,
    time: () => 0,
    subscribe: () => noop,
    toggle: noop,
    pause: noop,
    seek: noop,
    videoRef: () => noop,
  };
  const actions = new Proxy({}, { get: () => noop }) as TrackActions;
  const render = (clips: TimelineClip[], sources: ClipSource[], syncIds = new Set<string>()) =>
    renderToStaticMarkup(
      <TimelineTrack
        clips={clips}
        sources={sources}
        segments={[segment("s1", 0)]}
        selected={null}
        syncIds={syncIds}
        player={player}
        muted={false}
        readOnly={false}
        canUndo={false}
        canRedo={false}
        actions={actions}
      />,
    );

  test("段上写来源、版本和时长；待采用和失效段有各自的样子", () => {
    const html = render(
      [
        clip("a", { inMs: 2000, outMs: 9500, pinned: true }),
        clip("b", { taskId: "", outMs: 10000 }),
        clip("c"),
      ],
      [
        { kind: "video", url: null, durationMs: 15000, label: "片段 01", version: 2 },
        { kind: "placeholder", url: null, durationMs: 10000, label: "片段 02", version: null },
        { kind: "broken", url: null, durationMs: 15000, label: "片段 03", version: null },
      ],
    );
    expect(html).toContain("片段 01");
    expect(html).toContain(" · 版本 2");
    expect(html).toContain("7.5s");
    expect(html).toContain("lucide-pin");
    expect(html).toContain("片段 02");
    expect(html).toContain(" · 待采用");
    expect(html).toContain("border-destructive");
  });

  test("片场同步改过的段带标记", () => {
    const html = render(
      [clip("a")],
      [{ kind: "video", url: null, durationMs: 15000, label: "片段 01", version: 1 }],
      new Set(["a"]),
    );
    expect(html).toContain("border-sky-400");
  });

  test("没有段时提示", () => {
    expect(render([], [])).toContain("还没有片段");
  });
});
