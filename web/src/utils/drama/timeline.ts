import type { AssetDto } from "@/api/asset/type";
import type { Segment, Timeline, TimelineChange, TimelineClip } from "@/api/drama/type";

import type { AutosaveStatus } from "./autosave";
import { sortSegments } from "./segments";

/** 每段至少 0.5 秒（与后端一致） */
export const MIN_CLIP_MS = 500;
/** 图片默认 3 秒 */
export const IMAGE_DEFAULT_MS = 3000;
/** 图片最长 30 秒 */
export const MAX_IMAGE_MS = 30_000;

/** 一段的来源解析结果 */
export type ClipSource = {
  /** video / image 可播放；placeholder 是待采用的片段（合成时跳过）；broken 是素材已失效 */
  kind: "video" | "image" | "placeholder" | "broken";
  /** 素材地址；占位和失效为 null */
  url: string | null;
  /** 素材全长（毫秒）：视频是视频时长，图片是允许的最长时长，占位是片段秒数 */
  durationMs: number;
  /** 段上显示的名字：「片段 01」或素材文件名 */
  label: string;
  /** 片段结果在该片段里是第几版（从 1 起）；不是片段段为 null */
  version: number | null;
};

/** 编辑失败的原因（直接给用户看） */
export type EditError = { error: string };

/** 段的长度（毫秒） */
export const clipLength = (clip: TimelineClip): number => clip.outMs - clip.inMs;

/** 整条时间线的长度（毫秒） */
export const totalMs = (clips: readonly TimelineClip[]): number =>
  clips.reduce((sum, clip) => sum + clipLength(clip), 0);

/** 每段在时间线上的起点（毫秒） */
export function clipStarts(clips: readonly TimelineClip[]): number[] {
  let at = 0;
  return clips.map((clip) => {
    const start = at;
    at += clipLength(clip);
    return start;
  });
}

/** 时间 t 落在哪一段、段内偏移多少；t 在末尾或之外为 null */
export function clipAt(
  clips: readonly TimelineClip[],
  t: number,
): { index: number; offset: number } | null {
  const starts = clipStarts(clips);
  for (let index = 0; index < clips.length; index++) {
    const offset = t - starts[index];
    if (offset >= 0 && offset < clipLength(clips[index])) return { index, offset };
  }
  return null;
}

/** 离时间 t 最近的段边界是第几个插入位置（0 = 最前，clips.length = 最后） */
export function insertIndexAt(clips: readonly TimelineClip[], t: number): number {
  const bounds = [...clipStarts(clips), totalMs(clips)];
  let best = 0;
  bounds.forEach((bound, index) => {
    if (Math.abs(bound - t) < Math.abs(bounds[best] - t)) best = index;
  });
  return best;
}

/** 新段的 ID */
export const newClipId = (): string =>
  `c${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** 片段的显示名：「片段 01」 */
export const segmentLabel = (seq: number): string => `片段 ${String(seq + 1).padStart(2, "0")}`;

/** 是不是图片段 */
export const isImageClip = (clip: TimelineClip): boolean =>
  clip.kind === "asset" && clip.media === "image";

/** 是不是待采用占位 */
export const isPlaceholder = (clip: TimelineClip): boolean =>
  clip.kind === "segment" && !clip.taskId;

/** 片段的一条结果是第几版；takes 按创建时间正序 */
const versionOf = (segment: Segment, taskId: string): number =>
  segment.takes.findIndex((take) => take.taskId === taskId) + 1;

/** 片段里能用的结果：成功且有视频 */
const usableTake = (segment: Segment, taskId: string) =>
  segment.takes.find(
    (take) => take.taskId === taskId && take.status === "succeeded" && take.asset?.url,
  );

/**
 * 解析一段用的是什么素材。
 * invalid 是后端判定的失效段（固定版本不再可用等），以它为准；本地片段 / 素材找不到也算失效。
 */
export function resolveClip(
  clip: TimelineClip,
  segments: readonly Segment[],
  assets: ReadonlyMap<string, AssetDto>,
  invalid: ReadonlySet<string>,
): ClipSource {
  if (clip.kind === "segment") {
    const segment = segments.find((item) => item.id === clip.segmentId);
    const label = segment ? segmentLabel(segment.seq) : "片段";
    if (!segment || invalid.has(clip.id))
      return { kind: "broken", url: null, durationMs: clipLength(clip), label, version: null };
    if (!clip.taskId)
      return {
        kind: "placeholder",
        url: null,
        durationMs: segment.seconds * 1000,
        label,
        version: null,
      };
    const take = usableTake(segment, clip.taskId);
    if (!take?.asset)
      return { kind: "broken", url: null, durationMs: clipLength(clip), label, version: null };
    return {
      kind: "video",
      url: take.asset.url,
      durationMs: take.asset.durationMs || segment.seconds * 1000,
      label,
      version: versionOf(segment, clip.taskId),
    };
  }
  const asset = assets.get(clip.assetId);
  const label = asset?.fileName || (clip.media === "image" ? "图片" : "视频");
  if (!asset || asset.kind !== clip.media || invalid.has(clip.id)) {
    return { kind: "broken", url: null, durationMs: clipLength(clip), label, version: null };
  }
  return {
    kind: asset.kind,
    url: asset.url,
    durationMs: asset.kind === "image" ? MAX_IMAGE_MS : asset.durationMs || clipLength(clip),
    label,
    version: null,
  };
}

/** 片段的全长跟随段；没有采用就是按片段秒数占位 */
export function segmentClip(segment: Segment, id = newClipId()): TimelineClip {
  const take = segment.chosenTaskId ? usableTake(segment, segment.chosenTaskId) : undefined;
  return {
    id,
    kind: "segment",
    segmentId: segment.id,
    taskId: take ? segment.chosenTaskId : "",
    pinned: false,
    assetId: "",
    media: null,
    inMs: 0,
    outMs: take ? take.asset?.durationMs || segment.seconds * 1000 : segment.seconds * 1000,
    muted: false,
  };
}

/** 一条片段结果做成的段：拖入采用的版本是跟随段，其他版本是固定段 */
export function takeClip(segment: Segment, taskId: string): TimelineClip {
  const take = usableTake(segment, taskId);
  return {
    ...segmentClip(segment),
    taskId,
    pinned: taskId !== segment.chosenTaskId,
    outMs: take?.asset?.durationMs || segment.seconds * 1000,
  };
}

/** 一个素材做成的段：视频全长，图片默认 3 秒 */
export function assetClip(asset: AssetDto): TimelineClip {
  const image = asset.kind === "image";
  return {
    id: newClipId(),
    kind: "asset",
    segmentId: "",
    taskId: "",
    pinned: false,
    assetId: asset.id,
    media: image ? "image" : "video",
    inMs: 0,
    outMs: image ? IMAGE_DEFAULT_MS : asset.durationMs || IMAGE_DEFAULT_MS,
    muted: false,
  };
}

/** 没剪过的集：全部片段按序号、全长、跟随采用（共享只读时前端自己算，和后端默认时间线一致） */
export const defaultTimeline = (segments: readonly Segment[]): Timeline => ({
  clips: sortSegments(segments).map((segment) => segmentClip(segment, `d${segment.id}`)),
  muted: false,
  removedSegmentIds: [],
  imports: [],
});

/** 在时间 t 处把一段拆成两段，两段同源；返回新清单和后一段的 ID */
export function splitAt(
  clips: readonly TimelineClip[],
  t: number,
  newId: () => string = newClipId,
): { clips: TimelineClip[]; selectId: string } | EditError {
  const at = clipAt(clips, t);
  if (!at) return { error: "播放头不在任何一段上" };
  const clip = clips[at.index];
  if (isPlaceholder(clip)) return { error: "待采用的片段不能拆分" };
  if (at.offset < MIN_CLIP_MS || clipLength(clip) - at.offset < MIN_CLIP_MS) {
    return { error: "离段边缘太近（每段至少 0.5 秒）" };
  }
  const first = isImageClip(clip)
    ? { ...clip, outMs: at.offset }
    : { ...clip, outMs: clip.inMs + at.offset };
  const second = isImageClip(clip)
    ? { ...clip, id: newId(), outMs: clipLength(clip) - at.offset }
    : { ...clip, id: newId(), inMs: clip.inMs + at.offset };
  const next = [...clips];
  next.splice(at.index, 1, first, second);
  return { clips: next, selectId: second.id };
}

/** 把第 index 段播放头左边（left）或右边（right）的部分删掉；向左裁后播放头回到段首 */
export function trimToPlayhead(
  clips: readonly TimelineClip[],
  index: number,
  t: number,
  side: "left" | "right",
): { clips: TimelineClip[]; playhead: number } | EditError {
  const clip = clips[index];
  if (!clip) return { error: "先选中一段，或把播放头放到段上" };
  if (isPlaceholder(clip)) return { error: "待采用的片段不能裁剪" };
  const start = clipStarts(clips)[index];
  const offset = t - start;
  if (offset <= 0 || offset >= clipLength(clip)) return { error: "播放头要落在这一段中间" };
  const keep = side === "left" ? clipLength(clip) - offset : offset;
  if (keep < MIN_CLIP_MS) return { error: "裁完不足 0.5 秒，请改用删除" };
  let next: TimelineClip;
  if (isImageClip(clip)) next = { ...clip, outMs: keep };
  else if (side === "left") next = { ...clip, inMs: clip.inMs + offset };
  else next = { ...clip, outMs: clip.inMs + offset };
  const out = [...clips];
  out[index] = next;
  return { clips: out, playhead: side === "left" ? start : t };
}

/**
 * 拖段的左边（start）或右边（end）delta 毫秒后的段。
 * 视频改入点或出点，不超出素材 [0, maxMs]；图片两边都只改时长（0.5 秒到 maxMs）。每段至少 0.5 秒。
 */
export function trimEdge(
  clip: TimelineClip,
  side: "start" | "end",
  delta: number,
  maxMs: number,
): TimelineClip {
  const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
  if (isImageClip(clip)) {
    const length = side === "start" ? clip.outMs - delta : clip.outMs + delta;
    return { ...clip, inMs: 0, outMs: Math.round(clamp(length, MIN_CLIP_MS, maxMs)) };
  }
  if (side === "start")
    return { ...clip, inMs: Math.round(clamp(clip.inMs + delta, 0, clip.outMs - MIN_CLIP_MS)) };
  return { ...clip, outMs: Math.round(clamp(clip.outMs + delta, clip.inMs + MIN_CLIP_MS, maxMs)) };
}

/** 删一段；删的是片段段且这个片段在轨上已经没有别的段了，记进删除名单（片场再改也不自动加回） */
export function removeClip(timeline: Timeline, id: string): Timeline {
  const clip = timeline.clips.find((item) => item.id === id);
  if (!clip) return timeline;
  const clips = timeline.clips.filter((item) => item.id !== id);
  const gone =
    clip.kind === "segment" &&
    !clips.some((item) => item.kind === "segment" && item.segmentId === clip.segmentId) &&
    !timeline.removedSegmentIds.includes(clip.segmentId);
  return {
    ...timeline,
    clips,
    removedSegmentIds: gone
      ? [...timeline.removedSegmentIds, clip.segmentId]
      : timeline.removedSegmentIds,
  };
}

/** 在第 index 个插入位置插入一段；插回的片段从删除名单里移出 */
export function insertClip(timeline: Timeline, index: number, clip: TimelineClip): Timeline {
  const clips = [...timeline.clips];
  clips.splice(Math.min(Math.max(index, 0), clips.length), 0, clip);
  const removedSegmentIds =
    clip.kind === "segment"
      ? timeline.removedSegmentIds.filter((id) => id !== clip.segmentId)
      : timeline.removedSegmentIds;
  return { ...timeline, clips, removedSegmentIds };
}

/** 把第 from 段移到插入位置 to（to 按移走之前的清单算）；位置不变返回原数组 */
export function moveClip(clips: TimelineClip[], from: number, to: number): TimelineClip[] {
  if (to === from || to === from + 1) return clips;
  const next = [...clips];
  const [clip] = next.splice(from, 1);
  next.splice(to > from ? to - 1 : to, 0, clip);
  return next;
}

/**
 * 换版本：选一条结果就固定为它（选的正好是采用的那条就是跟随），选 follow 恢复跟随采用。
 * 入出点保留，超出新素材长度就收回；入点也越界就恢复全长。
 */
export function swapTake(
  clip: TimelineClip,
  segment: Segment,
  taskId: string | "follow",
): TimelineClip {
  const target = taskId === "follow" ? segment.chosenTaskId : taskId;
  const take = target ? usableTake(segment, target) : undefined;
  if (!take) return { ...clip, taskId: "", pinned: false, inMs: 0, outMs: segment.seconds * 1000 };
  const duration = take.asset?.durationMs || segment.seconds * 1000;
  const pinned = taskId !== "follow" && target !== segment.chosenTaskId;
  if (!clip.taskId) return { ...clip, taskId: target, pinned, inMs: 0, outMs: duration };
  let { inMs, outMs } = clip;
  outMs = Math.min(outMs, duration);
  if (inMs > outMs - MIN_CLIP_MS) [inMs, outMs] = [0, duration];
  return { ...clip, taskId: target, pinned, inMs, outMs };
}

/** 恢复原长：视频回到素材全长，图片回到默认 3 秒 */
export const restoreLength = (clip: TimelineClip, durationMs: number): TimelineClip =>
  isImageClip(clip)
    ? { ...clip, inMs: 0, outMs: IMAGE_DEFAULT_MS }
    : { ...clip, inMs: 0, outMs: durationMs };

/** 「合成」按钮不能点的原因；能点为 null */
export function composeReason(input: {
  timeline: Timeline;
  segments: readonly Segment[];
  assets: ReadonlyMap<string, AssetDto>;
  invalid: ReadonlySet<string>;
  save: AutosaveStatus;
}): string | null {
  const sources = input.timeline.clips.map((clip) =>
    resolveClip(clip, input.segments, input.assets, input.invalid),
  );
  const broken = sources.findIndex((source) => source.kind === "broken");
  if (broken >= 0) return `第 ${broken + 1} 段的素材已失效，请换版本或删掉`;
  if (!sources.some((source) => source.kind === "video" || source.kind === "image")) {
    return "至少要有一段可用的视频或图片才能合成";
  }
  if (input.save === "error" || input.save === "conflict") return "时间线没保存成功，先重试保存";
  return null;
}

/** 片场同步的一条变化写成给人看的话；clip 是变化后的段（已移除为 null） */
export function changeText(
  change: TimelineChange,
  segments: readonly Segment[],
  clip: TimelineClip | null,
): string {
  const segment = segments.find((item) => item.id === change.segmentId);
  const name = segmentLabel(segment?.seq ?? change.seq);
  const version = segment && clip?.taskId ? versionOf(segment, clip.taskId) : 0;
  switch (change.kind) {
    case "removed":
      return `${name} 已删除，已从时间线移除`;
    case "unadopted":
      return `${name} 取消了采用，变成待采用`;
    case "swapped":
      return `${name} 换成了采用的版本 ${version}`;
    case "adopted":
      return `${name} 已采用版本 ${version}`;
    case "added":
      return clip?.taskId ? `新增${name}` : `新增${name}（待采用）`;
  }
}
