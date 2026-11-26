import { useEffect, useState } from "react";

import { supportsTrim, trimEngine } from "@/utils/canvas/trim-engine";

/** 每秒一张，最多这么多张；缩放时只是挑不同的几张显示，不重新解码 */
const MAX_FRAMES = 120;
/** 缩略图高度（像素） */
const FRAME_HEIGHT = 72;

/** 按视频地址缓存整条缩略图；同一个视频拆成几段也只解码一次 */
const cache = new Map<string, Promise<(string | null)[]>>();

/** 读一个视频每秒一张的缩略图；浏览器不支持或解码失败返回空数组（段上显示纯色） */
function loadStrip(url: string, durationMs: number): Promise<(string | null)[]> {
  const hit = cache.get(url);
  if (hit) return hit;
  const seconds = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(durationMs / 1000)));
  const times = Array.from({ length: seconds }, (_, i) =>
    Math.min(i + 0.5, Math.max(0, durationMs / 1000 - 0.05)),
  );
  const task = supportsTrim()
    ? trimEngine.thumbnails(url, times, FRAME_HEIGHT, new AbortController().signal).catch(() => [])
    : Promise.resolve([]);
  cache.set(url, task);
  return task;
}

/**
 * 视频的缩略图条：第 i 张是第 i 秒附近的画面；还没读到或读不到为空数组。
 * @param url 视频地址；null 表示不是视频
 * @param durationMs 视频全长
 */
export function useThumbStrip(url: string | null, durationMs: number): (string | null)[] {
  const [frames, setFrames] = useState<(string | null)[]>([]);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    void loadStrip(url, durationMs).then((out) => {
      if (alive) setFrames(out);
    });
    return () => {
      alive = false;
    };
  }, [url, durationMs]);
  return url ? frames : [];
}
