import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { useReactFlow } from "@xyflow/react";
import { CircleX, Grid2x2, Loader2, RotateCw, Upload } from "lucide-react";
import { toast } from "sonner";

import type { Segment } from "@/api/drama/type";
import { confirm } from "@/components/admin-ui/confirm-dialog";
import { MediaPreview } from "@/components/canvas/media-preview";
import { useCanvasEditor } from "@/components/canvas-editor/editor-api";
import { submitNodeWhenReady } from "@/components/canvas-editor/node-actions";
import { Button } from "@/components/ui/button";
import { useRemoteModels } from "@/hooks/use-models";
import { useTextHashes } from "@/hooks/use-text-hashes";
import { DURATION, STAGGER, STAGGER_MAX } from "@/lib/motion";
import { useDramaSegmentsStore, segmentKey } from "@/store/drama-segments";
import type { CanvasEdge, CanvasNode } from "@/types";
import { sha256Hex } from "@/utils/drama/adaptation";
import {
  boardsFromGraph,
  boardStatus,
  type BoardNode,
  type BoardStatus,
} from "@/utils/drama/board";
import { ensureBoardNode, pickBoardModel } from "@/utils/drama/board-input";
import { reloadSegments } from "@/utils/drama/segment-events";
import { lowestUnit } from "@/utils/pricing/quote";

import { EmptyFrame, HOVER_PILL_CLASS, SEGMENT_CLASS } from "./asset-card";
import { CanvasTools } from "./assets-overlay";
import { useBoardsUi } from "./board-ui";
import { useWorkspace } from "./context";

const NO_SEGMENTS: Segment[] = [];
/** 改完节点数据后等一小会儿再提交：节点要重新渲染一次，提交读的才是新的提示词 */
const SETTLE_MS = 60;

const seqLabel = (segment: Segment) => String(segment.seq + 1).padStart(2, "0");

/** 当前集的片段：HTTP 读取 + WebSocket 推送（和片场共用一份 store） */
function useEpisodeSegments(dramaId: string, no: number) {
  const segments =
    useDramaSegmentsStore((state) => state.byEpisode[segmentKey(dramaId, no)]) ?? NO_SEGMENTS;
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let active = true;
    void reloadSegments(dramaId, no).then((ok) => active && setStatus(ok ? "ready" : "error"));
    const unwatch = useDramaSegmentsStore.getState().watch(dramaId, no);
    return () => {
      active = false;
      unwatch();
    };
  }, [dramaId, no]);
  return { segments, status };
}

/** 要补故事板的片段：没有、失败、原稿改过的，且原稿不为空 */
const needsBoard = (status: BoardStatus, segment: Segment) =>
  (status === "empty" || status === "failed" || status === "stale") && segment.prompt.trim() !== "";

/**
 * 故事板卡（外观同资产卡）：16:9 封面按状态显示——已出图、生成中、失败、待生成；原稿改过左上角标出来。
 * 悬停浮出胶囊：空卡「生成 · 上传」，出过图的「重新生成」。点整张卡到画布里看这个节点（还没有节点时不响应）。
 */
function BoardCard({
  segment,
  board,
  status,
  index,
  credits,
  blocked,
  onGenerate,
  onUpload,
  onLocate,
}: {
  segment: Segment;
  board: BoardNode | undefined;
  status: BoardStatus;
  index: number;
  /** 一张的最低积分；估不出来为 0 */
  credits: number;
  /** 不能生成的原因；能生成为 null */
  blocked: string | null;
  onGenerate: () => void;
  onUpload: () => void;
  onLocate: () => void;
}) {
  const name = `片段 ${seqLabel(segment)}`;
  const empty = !board?.src;
  const shots = board?.shotCount;
  return (
    <motion.div
      data-slot="board-card"
      aria-label={`${name} 故事板`}
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.base, delay: Math.min(index, STAGGER_MAX) * STAGGER }}
      className="group/card min-w-0"
    >
      <div className="bg-muted relative aspect-video overflow-hidden rounded-xl">
        {board?.src && status !== "running" && status !== "failed" ? (
          <>
            <div className="absolute inset-0">
              <MediaPreview src={board.src} alt={name} mode="thumb" fit="cover" draggable={false} />
            </div>
            {status === "stale" && (
              <span className="bg-chrome ring-chrome-border text-status-warning absolute top-2 left-2 rounded-full px-2 text-[11px] leading-5 ring-1 backdrop-blur-xl">
                原稿已改
              </span>
            )}
            <div className="from-cover-scrim absolute inset-x-0 bottom-0 bg-linear-to-t to-transparent px-3 pt-10 pb-2.5">
              <div className="text-cover-foreground truncate text-[13px] font-semibold">{name}</div>
            </div>
          </>
        ) : status === "running" ? (
          <EmptyFrame>
            <Loader2 className="size-5 animate-spin" />
            生成中
          </EmptyFrame>
        ) : status === "failed" ? (
          <EmptyFrame tone="error">
            <CircleX className="size-5" />
            生成失败
            <span className="text-muted-foreground line-clamp-2 max-w-[36ch] text-[11px]">
              {board?.error || "可以重试"}
            </span>
          </EmptyFrame>
        ) : (
          <EmptyFrame>
            <Grid2x2 className="size-5" />
            待生成
          </EmptyFrame>
        )}

        {status !== "running" && (
          <div className="absolute inset-x-2.5 bottom-2.5 z-20 flex justify-center">
            <div className={`${HOVER_PILL_CLASS} w-full max-w-sm`}>
              <button
                type="button"
                className={`${SEGMENT_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                disabled={!!blocked}
                title={blocked ?? undefined}
                onClick={onGenerate}
              >
                {!empty && <RotateCw />}
                {empty ? "生成" : "重新生成"}
                {credits > 0 && <span className="opacity-60 tabular-nums">· {credits}</span>}
              </button>
              {empty && (
                <>
                  <span aria-hidden className="bg-chrome-border h-4 w-px shrink-0" />
                  <button type="button" className={SEGMENT_CLASS} onClick={onUpload}>
                    <Upload />
                    上传
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {board && (
          <button
            type="button"
            aria-label={`在画布中打开${name}的故事板`}
            title="在画布中打开"
            onClick={onLocate}
            className="focus-visible:ring-ring/60 absolute inset-0 z-10 cursor-pointer rounded-[inherit] outline-none transition-colors duration-150 hover:bg-white/5 focus-visible:ring-3 focus-visible:ring-inset"
          />
        )}
      </div>

      <div className="px-0.5 pt-1.5">
        <div className="truncate text-[13px] font-medium">{name}</div>
        <div className="text-muted-foreground text-[11px] tabular-nums">
          {segment.seconds}s{shots ? ` · ${shots} 镜` : ""}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * 故事板页放进编辑器 overlay 插槽的内容：列表视图盖在画布上（每个片段一张卡），画布视图只摆底部工具。
 * 故事板就是短剧画布上的图片节点（drama.board 记着片段和出图时的原稿哈希），列表读的是同一份实时节点。
 */
export const BoardsOverlay = memo(function BoardsOverlay() {
  const ui = useBoardsUi();
  const editor = useCanvasEditor();
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  const { drama } = useWorkspace();
  const no = ui.episode.no;
  const { segments, status } = useEpisodeSegments(drama.id, no);
  const boards = useMemo(() => boardsFromGraph(editor.nodes), [editor.nodes]);
  const hashOf = useTextHashes(useMemo(() => segments.map((s) => s.prompt), [segments]));
  const remote = useRemoteModels("image");
  const model = useMemo(
    () => pickBoardModel(remote.models, drama.imageModels.board, drama.imageModels.scene),
    [drama.imageModels.board, drama.imageModels.scene, remote.models],
  );
  const credits = lowestUnit(model?.pricing);
  const template = drama.promptSettings.board.bodies?.board ?? "";
  const [busy, setBusy] = useState(false);

  const { clearSelection } = editor;
  useEffect(() => {
    if (ui.view === "list") clearSelection();
  }, [ui.view, clearSelection]);

  const statusOf = useCallback(
    (segment: Segment) => boardStatus(boards.get(segment.id), hashOf(segment.prompt)),
    [boards, hashOf],
  );

  const ensureNode = useCallback(
    (segment: Segment, hash: string) =>
      ensureBoardNode(flow, { segment, episodeNo: no, hash, model, template }),
    [flow, model, no, template],
  );

  const hashNow = useCallback(
    async (segment: Segment) => hashOf(segment.prompt) ?? (await sha256Hex(segment.prompt)),
    [hashOf],
  );

  /** 生成若干张：先依次建好节点，等一拍让节点重新渲染，再同时提交；没能开始的合成一条提示 */
  const generate = useCallback(
    async (targets: Segment[]) => {
      if (!model) {
        toast.error("没有可用的图片模型");
        return;
      }
      setBusy(true);
      try {
        const hashes = await Promise.all(targets.map(hashNow));
        const ids = targets.map((segment, i) => ensureNode(segment, hashes[i]));
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
        const reasons = (await Promise.all(ids.map((id) => submitNodeWhenReady(id)))).filter(
          (reason): reason is string => !!reason,
        );
        if (reasons.length > 0) {
          toast.error(
            targets.length === 1
              ? `没能开始生成：${reasons[0]}`
              : `${reasons.length} 张没能开始生成：${reasons[0]}`,
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [ensureNode, hashNow, model],
  );

  const targets = segments.filter((segment) => needsBoard(statusOf(segment), segment));
  const ready = segments.filter((segment) => statusOf(segment) === "ready").length;

  const generateMissing = async () => {
    const go = await confirm({
      title: `生成 ${targets.length} 张故事板？`,
      description: `${targets.map(seqLabel).join("、")}${credits > 0 ? `，约 ${credits * targets.length} 积分起` : ""}`,
      confirmLabel: "开始生成",
    });
    if (go) await generate(targets);
  };

  /** 空卡上传：先建好节点（记下当前原稿的哈希），等节点挂上再弹选择 */
  const fillWith = async (segment: Segment, pick: (id: string) => void) => {
    const id = ensureNode(segment, await hashNow(segment));
    setTimeout(() => pick(id), SETTLE_MS);
  };

  const locate = (id: string) => {
    ui.setView("canvas");
    // 切回画布视图后再飞过去，让用户看得到节点
    requestAnimationFrame(() => editor.focusNode(id));
  };

  const header = ui.headerTarget
    ? createPortal(
        <>
          <span className="text-muted-foreground text-xs tabular-nums max-sm:hidden">
            {ready}/{segments.length}
          </span>
          <Button
            size="sm"
            disabled={targets.length === 0 || !model || busy}
            title={targets.length === 0 ? "每个片段都有可用的故事板" : undefined}
            onClick={() => void generateMissing()}
          >
            生成本集故事板
            {targets.length > 0 && <span className="tabular-nums">· {targets.length}</span>}
          </Button>
        </>,
        ui.headerTarget,
      )
    : null;

  if (ui.view === "canvas") {
    return (
      <>
        {header}
        <CanvasTools />
      </>
    );
  }

  return (
    <div className="bg-background absolute inset-0 z-20 overflow-y-auto">
      {header}
      {status === "loading" && segments.length === 0 ? (
        <div className="text-muted-foreground grid h-full place-items-center">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : status === "error" && segments.length === 0 ? (
        <div className="text-muted-foreground grid h-full place-items-center text-sm">
          片段读取失败
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-5 p-5 max-lg:grid-cols-2 max-sm:grid-cols-1">
          {segments.map((segment, index) => {
            const board = boards.get(segment.id);
            const state = statusOf(segment);
            return (
              <BoardCard
                key={segment.id}
                segment={segment}
                board={board}
                status={state}
                index={index}
                credits={credits}
                blocked={
                  busy
                    ? "正在提交"
                    : !model
                      ? "没有可用的图片模型"
                      : !segment.prompt.trim()
                        ? "片段原稿是空的"
                        : null
                }
                onGenerate={() => void generate([segment])}
                onUpload={() => void fillWith(segment, editor.fill.pickFile)}
                onLocate={() => board && locate(board.nodeId)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});
