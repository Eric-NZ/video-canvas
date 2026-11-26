import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ClipSource } from "@/utils/drama/timeline";

/** 播放器眼里的一段：时间线位置 + 素材内入出点 */
export type PlayerItem = {
  id: string;
  kind: ClipSource["kind"];
  url: string | null;
  /** 在时间线上的起点（毫秒） */
  start: number;
  inMs: number;
  outMs: number;
  /** 这段播放时静音（段静音或整轨静音） */
  muted: boolean;
};

/** 双缓冲的两个 video */
export type Slot = 0 | 1;

/** 到段尾前多少毫秒就切下一段，抵消一帧的延迟 */
const EDGE_MS = 15;

const lengthOf = (item: PlayerItem) => item.outMs - item.inMs;

/** 时间 t 落在第几段；t 到末尾时停在最后一段（显示最后一帧） */
function indexAt(items: readonly PlayerItem[], t: number): number {
  if (items.length === 0) return -1;
  const at = items.findIndex((item) => t >= item.start && t < item.start + lengthOf(item));
  return at >= 0 ? at : items.length - 1;
}

/** 时间线播放器对外的状态与动作 */
export type TimelinePlayer = {
  playing: boolean;
  /** 当前画面是第几段；没有段为 -1 */
  index: number;
  /** 正在显示画面的 video 槽位 */
  activeSlot: Slot;
  /** 总时长（毫秒） */
  total: number;
  /** 当前时间（毫秒）；高频读取用，不触发渲染 */
  time: () => number;
  /** 订阅时间变化（每帧），返回取消订阅 */
  subscribe: (listener: () => void) => () => void;
  toggle: () => void;
  pause: () => void;
  /** 跳到时间线上的某一毫秒 */
  seek: (t: number) => void;
  /** 两个 video 的 ref 回调 */
  videoRef: (slot: Slot) => (el: HTMLVideoElement | null) => void;
};

/**
 * 时间线预览播放：按清单依次播各段，视频按入出点截取，图片和待采用占位按时长走钟。
 * 两个 video 双缓冲：当前段在一个里播，下一段在另一个里预加载并定位到入点，切换只是换可见的那个；
 * 同一个视频拆开后首尾相接的两段直接接着播，不切换。
 * 时钟：当前段是正在播放的视频时跟着视频走（视频卡住时间线也等），否则按真实时间走。
 */
export function useTimelinePlayer(items: readonly PlayerItem[]): TimelinePlayer {
  const total = useMemo(() => items.reduce((sum, item) => sum + lengthOf(item), 0), [items]);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(-1);
  const [activeSlot, setActiveSlot] = useState<Slot>(0);

  const itemsRef = useRef(items);
  const totalRef = useRef(total);
  const timeRef = useRef(0);
  const indexRef = useRef(-1);
  const activeRef = useRef<Slot>(0);
  const playingRef = useRef(false);
  const videos = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null]);
  /** 每个槽位预备好的是哪一段（段 ID）；切换时据此判断能不能直接换过去 */
  const preparedFor = useRef<[string | null, string | null]>([null, null]);
  const listeners = useRef(new Set<() => void>());

  const notify = useCallback(() => listeners.current.forEach((listener) => listener()), []);

  /** 把某段装进槽位并定位到段内 offset；同一个地址不重复装，元数据没到就等它到了再定位 */
  const prepare = useCallback((slot: Slot, item: PlayerItem | undefined, offset: number) => {
    const video = videos.current[slot];
    if (!video) return;
    if (!item || item.kind !== "video" || !item.url) {
      preparedFor.current[slot] = null;
      return;
    }
    preparedFor.current[slot] = item.id;
    const at = (item.inMs + offset) / 1000;
    if (video.dataset.src !== item.url) {
      video.dataset.src = item.url;
      video.src = item.url;
      video.load();
    }
    if (video.readyState >= 1) video.currentTime = at;
    else video.addEventListener("loadedmetadata", () => (video.currentTime = at), { once: true });
  }, []);

  const playVideo = useCallback((slot: Slot) => {
    void videos.current[slot]?.play().catch(() => {
      // 浏览器拦了自动播放或视频读不出来：回到暂停，用户可以再点
      playingRef.current = false;
      setPlaying(false);
    });
  }, []);

  /** 显示第 i 段的 offset 处：已在另一个槽位预备好就换过去，否则装进当前槽位；再预加载下一段 */
  const show = useCallback(
    (i: number, offset: number, autoplay: boolean) => {
      const list = itemsRef.current;
      const item = list[i];
      indexRef.current = i;
      setIndex(i);
      if (!item) return;
      let slot = activeRef.current;
      if (item.kind === "video") {
        const other = (1 - slot) as Slot;
        if (preparedFor.current[other] === item.id && offset === 0) slot = other;
        else prepare(slot, item, offset);
        activeRef.current = slot;
        setActiveSlot(slot);
        const video = videos.current[slot];
        if (video) video.muted = item.muted;
      }
      const other = (1 - slot) as Slot;
      videos.current[other]?.pause();
      const next = list[i + 1];
      if (next?.kind === "video") prepare(other, next, 0);
      if (item.kind === "video" && autoplay) playVideo(slot);
      else videos.current[slot]?.pause();
    },
    [playVideo, prepare],
  );

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(t, totalRef.current));
      timeRef.current = clamped;
      const i = indexAt(itemsRef.current, clamped);
      const item = itemsRef.current[i];
      show(i, item ? Math.min(clamped - item.start, lengthOf(item)) : 0, playingRef.current);
      notify();
    },
    [notify, show],
  );

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    videos.current.forEach((video) => video?.pause());
  }, []);

  const toggle = useCallback(() => {
    if (playingRef.current) return pause();
    if (itemsRef.current.length === 0) return;
    if (timeRef.current >= totalRef.current - EDGE_MS) timeRef.current = 0;
    playingRef.current = true;
    setPlaying(true);
    seek(timeRef.current);
  }, [pause, seek]);

  // 清单变了（剪辑、换版本、静音）：按当前时间重新定位
  useEffect(() => {
    itemsRef.current = items;
    totalRef.current = total;
    if (items.length === 0) {
      pause();
      timeRef.current = 0;
      indexRef.current = -1;
      setIndex(-1);
      notify();
      return;
    }
    seek(timeRef.current);
  }, [items, total, notify, pause, seek]);

  // 播放时每帧推进时钟，到段尾切下一段，到结尾停下
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      const list = itemsRef.current;
      const i = indexRef.current;
      const item = list[i];
      if (!item) return pause();
      const video = videos.current[activeRef.current];
      const following = item.kind === "video" && video && !video.paused && video.readyState >= 2;
      let t = following
        ? item.start + (video.currentTime * 1000 - item.inMs)
        : timeRef.current + dt;
      if (t >= item.start + lengthOf(item) - EDGE_MS) {
        const next = list[i + 1];
        if (!next) {
          t = totalRef.current;
          timeRef.current = t;
          notify();
          return pause();
        }
        const contiguous =
          item.kind === "video" &&
          next.kind === "video" &&
          next.url === item.url &&
          next.inMs === item.outMs;
        if (contiguous) {
          indexRef.current = i + 1;
          setIndex(i + 1);
          if (video) video.muted = next.muted;
          const other = (1 - activeRef.current) as Slot;
          if (list[i + 2]?.kind === "video") prepare(other, list[i + 2], 0);
        } else show(i + 1, 0, true);
        t = next.start;
      }
      timeRef.current = Math.max(item.start, t);
      notify();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, notify, pause, prepare, show]);

  // 离开页面时停止，避免后台继续出声
  useEffect(() => {
    const held = videos.current;
    return () => held.forEach((video) => video?.pause());
  }, []);

  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  const videoRef = useCallback(
    (slot: Slot) => (el: HTMLVideoElement | null) => {
      videos.current[slot] = el;
    },
    [],
  );

  const time = useCallback(() => timeRef.current, []);

  return { playing, index, activeSlot, total, time, subscribe, toggle, pause, seek, videoRef };
}
