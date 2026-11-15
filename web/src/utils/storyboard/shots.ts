import {
  CAMERA_MOVES,
  DEFAULT_SHOT_DURATION,
  MAX_SHOT_DURATION,
  MIN_SHOT_DURATION,
  SHOT_SIZES,
} from "@/constants/storyboard";
import type { CameraMove, NodeStoryboard, ShotSize, StoryboardShot } from "@/types";

/** 生成行 id 的函数，测试里换成可预测的 */
type NewId = () => string;

const defaultId: NewId = () => crypto.randomUUID();

/** 保留 1 位小数，顺带抹掉 0.1 + 0.2 这类浮点误差 */
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 新建的分镜表：没有镜头 */
export function emptyStoryboard(): NodeStoryboard {
  return { shots: [] };
}

/** 一行空镜头：字段都空着，时长取默认值 */
function emptyShot(newId: NewId): StoryboardShot {
  return {
    id: newId(),
    scene: "",
    shot: "",
    camera: "",
    action: "",
    dialogue: "",
    duration: DEFAULT_SHOT_DURATION,
  };
}

/** 时长规整到 1–60 秒、1 位小数；不是有限数字时取默认值 */
export function clampDuration(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SHOT_DURATION;
  return round1(Math.min(MAX_SHOT_DURATION, Math.max(MIN_SHOT_DURATION, value)));
}

/** 末尾加一行空镜头 */
export function addShot(board: NodeStoryboard, newId: NewId = defaultId): NodeStoryboard {
  return { shots: [...board.shots, emptyShot(newId)] };
}

/** 在 anchorId 那行的上方或下方插一行空镜头；那行不存在时加到末尾 */
export function insertShot(
  board: NodeStoryboard,
  anchorId: string,
  side: "before" | "after",
  newId: NewId = defaultId,
): NodeStoryboard {
  const index = board.shots.findIndex((s) => s.id === anchorId);
  if (index < 0) return addShot(board, newId);
  const at = side === "before" ? index : index + 1;
  return { shots: [...board.shots.slice(0, at), emptyShot(newId), ...board.shots.slice(at)] };
}

/** 复制一行，副本换新 id、紧跟在原行后面；那行不存在时原样返回 */
export function duplicateShot(
  board: NodeStoryboard,
  id: string,
  newId: NewId = defaultId,
): NodeStoryboard {
  const index = board.shots.findIndex((s) => s.id === id);
  if (index < 0) return board;
  const copy = { ...board.shots[index], id: newId() };
  return {
    shots: [...board.shots.slice(0, index + 1), copy, ...board.shots.slice(index + 1)],
  };
}

/** 删一行；那行不存在时原样返回 */
export function removeShot(board: NodeStoryboard, id: string): NodeStoryboard {
  if (!board.shots.some((s) => s.id === id)) return board;
  return { shots: board.shots.filter((s) => s.id !== id) };
}

/** 改一行的字段，时长顺带规整；其余行保持原引用，表格行可以按引用跳过重渲染 */
export function updateShot(
  board: NodeStoryboard,
  id: string,
  patch: Partial<Omit<StoryboardShot, "id">>,
): NodeStoryboard {
  return {
    shots: board.shots.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s, ...patch };
      return "duration" in patch ? { ...next, duration: clampDuration(next.duration) } : next;
    }),
  };
}

/** 把一行拖到第 toIndex 位（从 0 起），越界夹到两端；那行不存在时原样返回 */
export function moveShot(board: NodeStoryboard, id: string, toIndex: number): NodeStoryboard {
  const from = board.shots.findIndex((s) => s.id === id);
  if (from < 0) return board;
  const rest = board.shots.filter((s) => s.id !== id);
  const at = Math.min(rest.length, Math.max(0, toIndex));
  return { shots: [...rest.slice(0, at), board.shots[from], ...rest.slice(at)] };
}

/** 行 id → 镜号：按行序从 1 起连续编号，镜号不存档，所以排序后不会错位 */
export function shotNumbers(board: NodeStoryboard): Record<string, number> {
  return Object.fromEntries(board.shots.map((s, i) => [s.id, i + 1]));
}

/** 总时长（秒），保留 1 位小数 */
export function totalDuration(board: NodeStoryboard): number {
  return round1(board.shots.reduce((sum, s) => sum + s.duration, 0));
}

/** 秒数显示成 mm:ss，不足 1 秒的部分向上取整 */
export function formatDuration(seconds: number): string {
  const total = Math.ceil(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | "" =>
  list.includes(v as T) ? (v as T) : "";

/**
 * 读档时规整分镜表：结构不对读成空表，坏行丢掉，不认识的景别 / 运镜清空，
 * 时长修正到 1–60 秒，缺字段补默认，缺 id 或 id 重复的换新 id。多余字段不保留。
 */
export function normalizeStoryboard(raw: unknown, newId: NewId = defaultId): NodeStoryboard {
  const list = (raw as { shots?: unknown } | null | undefined)?.shots;
  if (!Array.isArray(list)) return emptyStoryboard();
  const seen = new Set<string>();
  const shots: StoryboardShot[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    let id = str(s.id);
    if (!id || seen.has(id)) id = newId();
    seen.add(id);
    shots.push({
      id,
      scene: str(s.scene),
      shot: oneOf<ShotSize>(SHOT_SIZES, s.shot),
      camera: oneOf<CameraMove>(CAMERA_MOVES, s.camera),
      action: str(s.action),
      dialogue: str(s.dialogue),
      duration: clampDuration(s.duration),
    });
  }
  return { shots };
}
