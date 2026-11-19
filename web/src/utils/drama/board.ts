import type { BoardLayout } from "@/api/drama/type";
import type { CanvasNodeData } from "@/types";

/**
 * 故事板：每个片段一张宫格分镜图（docs/design/故事板/故事板.md）。
 * 格子按原稿【时间轴】的镜头一一对应，生视频时采用版作为第一张参考图。
 */

/** 生视频时加在提示词最前面的一行，告诉模型图片1是什么、只参考什么 */
export const BOARD_LINE =
  "图片1是本段的分镜宫格图，按格子编号顺序对应各个镜头，只参考构图、站位与景别；成片是完整连续的画面，不带宫格线和编号。";

/** 故事板固定横版 16:9，不跟短剧画幅 */
export const BOARD_RATIO = "16:9";

/** 固定写在提示词最后：不要字幕等文字元素，人物与参考图保持一致 */
export const BOARD_SUFFIX =
  "无字幕，无贴图，无旁白，无背景音乐，保持人物与参考图完全一致，面部特征100%相同，保持相同的骨骼结构、眼间距和下颚几何形状，禁止美化，禁止改变年龄";

/** 一个宫格最多几格；镜头再多就合并进最后一格 */
const MAX_CELLS = 9;

/** 【时间轴】里一个镜头行：「0-3秒：」「6-9.5秒：」开头 */
const SHOT_RE = /^\s*\d+(?:\.\d+)?\s*[-–~]\s*\d+(?:\.\d+)?\s*秒\s*[:：]\s*(.*)$/;
/** 不画进宫格的句子：台词、对白、声音 */
const SPOKEN_RE = /^(台词|对白|声音|音效|环境声)/;

/** 取某个分栏（【名】开头那一行）冒号后的正文；没有为空串 */
function section(prompt: string, name: string): string {
  const line = prompt.split("\n").find((item) => item.trim().startsWith(`【${name}】`));
  return line
    ? line
        .trim()
        .slice(name.length + 2)
        .trim()
    : "";
}

/** 去掉一镜里的台词和声音，只留看得见的画面 */
function visual(text: string): string {
  return text
    .split("。")
    .map((part) => part.trim())
    .filter((part) => part && !part.includes("『") && !SPOKEN_RE.test(part))
    .map((part) => `${part}。`)
    .join("");
}

/**
 * 原稿【时间轴】里的镜头画面，按先后排列；时间、台词和声音都去掉。
 * 没有时间轴分栏为空数组。
 */
export function shotLines(prompt: string): string[] {
  const lines = prompt.split("\n");
  const start = lines.findIndex((line) => line.trim().startsWith("【时间轴】"));
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("【")) break;
    const match = line.match(SHOT_RE);
    if (match) out.push(visual(match[1]));
  }
  return out;
}

/**
 * 按镜头数选宫格（整图 16:9 横版）：1–4 镜 2x2；5–6 镜 3 列 2 行；7 镜以上 3x3。
 * 识别不到镜头（0）也按 2x2。
 */
export function boardLayout(shots: number): { layout: BoardLayout; cols: number; rows: number } {
  if (shots <= 4) return { layout: "2x2", cols: 2, rows: 2 };
  if (shots <= 6) return { layout: "3x2", cols: 3, rows: 2 };
  return { layout: "3x3", cols: 3, rows: 3 };
}

/**
 * 拼宫格图的图片提示词（内置模板，不调文本模型，用户不另写）：宫格说明 + 原稿的画面风格、场景与光、人物与道具、站位 + 逐镜画面。
 * 原稿里的 `@[名](节点id)` 原样保留，组装 input 时换成参考图编号。
 * @returns text 提示词；layout 布局；shotCount 数出的镜头数；notice 给用户看的提醒（没有为空串）
 */
export function boardPrompt(prompt: string): {
  text: string;
  layout: BoardLayout;
  shotCount: number;
  notice: string;
} {
  const shots = shotLines(prompt);
  const { layout, cols, rows } = boardLayout(shots.length);
  const cells = cols * rows;
  let notice = "";
  let body: string;
  if (shots.length === 0) {
    notice = "没识别到时间轴，按 4 格生成";
    body = `按下面的片段内容拆成 ${cells} 个镜头：\n${prompt.trim()}`;
  } else {
    const shown =
      shots.length > MAX_CELLS
        ? [...shots.slice(0, MAX_CELLS - 1), shots.slice(MAX_CELLS - 1).join("；")]
        : shots;
    if (shots.length > MAX_CELLS) {
      notice = `镜头过多（${shots.length} 个），第 9 格合并了剩下的镜头，建议拆段`;
    }
    body = [
      ...[
        ["画面风格", section(prompt, "画幅风格")],
        ["场景与光", section(prompt, "场景与光")],
        ["人物与道具", section(prompt, "参考与人物")],
        ["站位", section(prompt, "站位")],
      ]
        .filter(([, value]) => value)
        .map(([name, value]) => `${name}：${value}`),
      "镜头：",
      ...shown.map((shot, index) => `${index + 1}. ${shot}`),
    ].join("\n");
  }
  const text = [
    `生成一张 ${cells} 格分镜图：${cols} 列 ${rows} 行，整图比例 ${BOARD_RATIO}，从左到右、从上到下依次对应下面的镜头。每格右上角标出编号，格与格之间用细白线隔开，没用到的格子留白；只画画面，不写台词和说明文字。`,
    body,
    BOARD_SUFFIX,
  ].join("\n");
  return { text, layout, shotCount: shots.length, notice };
}

/** 故事板节点的 drama.board：属于哪个片段、出图时的原稿哈希、宫格信息（前端写入，后端据此数故事板） */
export type NodeBoardMeta = {
  segmentId: string;
  /** 出图时原稿的 SHA-256；和当前原稿不同即已过期 */
  sourceHash: string;
  layout: BoardLayout;
  shotCount: number;
};

/** 画布上一个片段的故事板节点（读自画布，不另存） */
export type BoardNode = NodeBoardMeta & {
  nodeId: string;
  /** 当前那一版图片；还没出图为 null。重新生成时仍是上一版 */
  src: string | null;
  assetId?: string;
  status: "idle" | "running" | "error" | "done";
  /** 失败原因 */
  error: string;
};

/** 读故事板只用到的节点字段：编辑器里的节点和接口读到的画布节点都满足 */
type BoardNodeData = {
  drama?: CanvasNodeData["drama"] | null;
  src?: string | null;
  assetId?: string | null;
  status?: string | null;
  uploadProgress?: number | null;
  error?: string | null;
};

/** 节点数据里的 drama.board；不是故事板节点为 null */
export function boardMetaOf(data: BoardNodeData): NodeBoardMeta | null {
  const board = data.drama?.board as Partial<NodeBoardMeta> | undefined;
  if (!board || typeof board.segmentId !== "string" || !board.segmentId) return null;
  return {
    segmentId: board.segmentId,
    sourceHash: typeof board.sourceHash === "string" ? board.sourceHash : "",
    layout: board.layout ?? "2x2",
    shotCount: typeof board.shotCount === "number" ? board.shotCount : 0,
  };
}

/** 是不是故事板节点：资产列表、@ 候选都不收它 */
export const isBoardNode = (data: BoardNodeData): boolean => boardMetaOf(data) !== null;

/** 画布节点里的故事板，按片段 id 取；组节点略过，同一片段有多个时取后面的 */
export function boardsFromGraph(
  nodes: readonly { id: string; type?: string; data: object }[],
): Map<string, BoardNode> {
  const out = new Map<string, BoardNode>();
  for (const node of nodes) {
    if (node.type === "group") continue;
    const data = node.data as BoardNodeData;
    const meta = boardMetaOf(data);
    if (!meta) continue;
    const src = data.src && !data.src.startsWith("blob:") ? data.src : null;
    const status =
      data.status === "running" ||
      (data.uploadProgress !== undefined && data.uploadProgress !== null)
        ? "running"
        : data.status === "error"
          ? "error"
          : src
            ? "done"
            : "idle";
    out.set(meta.segmentId, {
      ...meta,
      nodeId: node.id,
      src,
      assetId: src ? (data.assetId ?? undefined) : undefined,
      status,
      error: data.error ?? "",
    });
  }
  return out;
}

/** 一个片段的故事板状态：empty 没有 / running 在出图 / failed 失败 / stale 原稿改过 / ready 可用 */
export type BoardStatus = "empty" | "running" | "failed" | "stale" | "ready";

/**
 * @param board 片段的故事板节点；没有为 undefined
 * @param hash 片段当前原稿的哈希；还没算出来为 undefined（先按没过期）
 */
export function boardStatus(board: BoardNode | undefined, hash: string | undefined): BoardStatus {
  if (!board) return "empty";
  if (board.status === "running") return "running";
  if (board.status === "error") return "failed";
  if (!board.src) return "empty";
  return hash !== undefined && hash !== board.sourceHash ? "stale" : "ready";
}

/** 生视频时能带入的故事板：节点有图（生成中沿用上一版）；没有为 null */
export type BoardRef = { assetId: string; src: string; stale: boolean };

export function boardRef(board: BoardNode | undefined, hash: string | undefined): BoardRef | null {
  if (!board?.src || !board.assetId) return null;
  return {
    assetId: board.assetId,
    src: board.src,
    stale: hash !== undefined && hash !== board.sourceHash,
  };
}
