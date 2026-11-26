import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { uploadAsset } from "@/api/asset";
import type { AssetDto } from "@/api/asset/type";
import { getCanvas } from "@/api/canvas";
import type { Segment } from "@/api/drama/type";
import { VideoPoster } from "@/components/canvas/media-preview";
import { UPLOAD_SIZE_LIMIT } from "@/constants/canvas";
import { cn } from "@/lib/utils";
import { sortSegments } from "@/utils/drama/segments";
import { segmentLabel } from "@/utils/drama/timeline";

import { startTimelineDrag, type TimelineDragPayload } from "./drag";

type Tab = "segments" | "canvas" | "imports";
type Filter = "all" | "video" | "image";

/** 画布上一个能放进时间线的素材 */
type CanvasMedia = { assetId: string; url: string; kind: "video" | "image"; label: string };

/** 正在上传的本地文件 */
type Upload = { key: string; file: File; progress: number; failed: boolean };

const TABS: { value: Tab; label: string }[] = [
  { value: "segments", label: "片段" },
  { value: "canvas", label: "画布素材" },
  { value: "imports", label: "已导入" },
];

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "video", label: "视频" },
  { value: "image", label: "图片" },
];

/**
 * 成片剪辑台左侧的素材面板：片段的各版结果、画布上的图片视频、本地导入的素材。
 * 拖到时间线上插入，或点「+」接在播放头所在段之后。
 */
export function MediaPanel({
  segments,
  canvasId,
  imports,
  onTimeline,
  aspect,
  readOnly,
  onAdd,
  onImported,
}: {
  segments: readonly Segment[];
  canvasId: string;
  /** 「已导入」的素材 */
  imports: readonly AssetDto[];
  /** 已经在时间线上的结果任务 ID */
  onTimeline: ReadonlySet<string>;
  /** CSS aspect-ratio，如 9/16 */
  aspect: string;
  readOnly: boolean;
  /** 点「+」：加到播放头所在段之后 */
  onAdd: (payload: TimelineDragPayload) => void;
  /** 本地导入成功 */
  onImported: (asset: AssetDto) => void;
}) {
  const [tab, setTab] = useState<Tab>("segments");
  const [filter, setFilter] = useState<Filter>("all");
  const [canvas, setCanvas] = useState<CanvasMedia[] | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // 第一次打开「画布素材」才读画布：画布内容可能很大，不在进成片页时就拉
  useEffect(() => {
    if (tab !== "canvas" || canvas !== null) return;
    let alive = true;
    getCanvas(canvasId)
      .then((detail) => {
        if (!alive) return;
        const out: CanvasMedia[] = [];
        for (const node of detail.graph.nodes) {
          // 分组节点没有 kind，只要带素材的图片、视频节点
          if (!node.data || !("kind" in node.data)) continue;
          const data = node.data;
          const kind = data.mediaType ?? data.kind;
          if (!data?.assetId || !data.src || data.src.startsWith("blob:")) continue;
          if (kind !== "video" && kind !== "image") continue;
          out.push({
            assetId: data.assetId,
            url: data.src,
            kind,
            label: data.label || data.fileName || "",
          });
        }
        setCanvas(out);
      })
      .catch(() => alive && setCanvas([]));
    return () => {
      alive = false;
    };
  }, [tab, canvas, canvasId]);

  const upload = async (item: Upload) => {
    setUploads((list) =>
      list.map((u) => (u.key === item.key ? { ...u, progress: 0, failed: false } : u)),
    );
    try {
      const asset = await uploadAsset(item.file, {
        onProgress: (progress) =>
          setUploads((list) => list.map((u) => (u.key === item.key ? { ...u, progress } : u))),
      });
      setUploads((list) => list.filter((u) => u.key !== item.key));
      onImported(asset);
    } catch {
      setUploads((list) => list.map((u) => (u.key === item.key ? { ...u, failed: true } : u)));
    }
  };

  const pickFiles = (files: FileList | null) => {
    const picked: Upload[] = [];
    for (const file of Array.from(files ?? [])) {
      const kind = file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("image/")
          ? "image"
          : null;
      if (!kind) {
        toast.error(`${file.name} 不是视频或图片`);
        continue;
      }
      if (file.size > UPLOAD_SIZE_LIMIT[kind]) {
        toast.error(`${file.name} 超过 ${UPLOAD_SIZE_LIMIT[kind] / 1024 / 1024}MB`);
        continue;
      }
      picked.push({
        key: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        progress: 0,
        failed: false,
      });
    }
    if (picked.length === 0) return;
    setTab("imports");
    setUploads((list) => [...picked, ...list]);
    picked.forEach((item) => void upload(item));
  };

  const matches = (kind: string) => filter === "all" || filter === kind;

  return (
    <aside
      aria-label="素材"
      className="bg-chrome ring-chrome-border flex w-[300px] shrink-0 flex-col rounded-2xl ring-1 [corner-shape:squircle] max-lg:hidden"
    >
      <div role="tablist" className="flex gap-1 px-3 pt-3 pb-2">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={tab === item.value}
            onClick={() => setTab(item.value)}
            className={cn(
              "h-8 rounded-full px-3 text-[13px] font-medium transition-colors",
              tab === item.value
                ? "bg-chrome-hover ring-chrome-border text-foreground ring-1"
                : "text-muted-foreground hover:bg-chrome-hover hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab !== "segments" && (
        <div className="flex items-center gap-3 px-4 pb-2 text-[12.5px]">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={cn(
                "border-b-2 pb-0.5",
                filter === item.value
                  ? "text-foreground border-foreground"
                  : "text-muted-foreground border-transparent hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
          <span className="flex-1" />
          {tab === "imports" && !readOnly && (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="hover:bg-chrome-hover ring-chrome-border flex h-7 items-center gap-1 rounded-full px-2.5 ring-1"
            >
              <Plus className="size-3.5" />
              导入
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="video/*,image/*"
            multiple
            hidden
            onChange={(event) => {
              pickFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
        onDragOver={(event) => {
          if (tab === "imports" && !readOnly && event.dataTransfer.types.includes("Files"))
            event.preventDefault();
        }}
        onDrop={(event) => {
          if (tab !== "imports" || readOnly || event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          pickFiles(event.dataTransfer.files);
        }}
      >
        {tab === "segments" &&
          (segments.length === 0 ? (
            <Empty text="这一集还没有片段" />
          ) : (
            sortSegments(segments).map((segment) => {
              const takes = segment.takes
                .map((take, index) => ({ take, version: index + 1 }))
                .filter(({ take }) => take.status === "succeeded" && take.asset?.url);
              return (
                <section key={segment.id} className="mb-3">
                  <h4 className="text-muted-foreground mx-0.5 mb-1.5 text-xs font-medium">
                    {segmentLabel(segment.seq)} · {segment.seconds}s
                  </h4>
                  {takes.length === 0 ? (
                    <p className="text-muted-foreground mx-0.5 text-xs">还没有可用视频</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-1.5">
                      {takes.map(({ take, version }) => (
                        <Tile
                          key={take.taskId}
                          aspect={aspect}
                          readOnly={readOnly}
                          payload={{ type: "take", segmentId: segment.id, taskId: take.taskId }}
                          onAdd={onAdd}
                          title={`版本 ${version}`}
                          sub={
                            take.asset?.durationMs
                              ? `${Math.round(take.asset.durationMs / 1000)}s`
                              : ""
                          }
                          badge={take.taskId === segment.chosenTaskId ? "已采用" : null}
                          onTimeline={onTimeline.has(take.taskId)}
                        >
                          <VideoPoster src={take.asset!.url} />
                        </Tile>
                      ))}
                    </div>
                  )}
                </section>
              );
            })
          ))}

        {tab === "canvas" &&
          (canvas === null ? (
            <div className="text-muted-foreground grid place-items-center py-10">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : canvas.filter((item) => matches(item.kind)).length === 0 ? (
            <Empty text="画布上还没有图片或视频" />
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {canvas
                .filter((item) => matches(item.kind))
                .map((item) => (
                  <Tile
                    key={`${item.assetId}-${item.url}`}
                    aspect={aspect}
                    readOnly={readOnly}
                    payload={{ type: "canvas", assetId: item.assetId }}
                    onAdd={onAdd}
                    title={item.label}
                    sub={item.kind === "image" ? "图片" : "视频"}
                  >
                    <Thumb kind={item.kind} url={item.url} />
                  </Tile>
                ))}
            </div>
          ))}

        {tab === "imports" &&
          (uploads.length === 0 && imports.filter((asset) => matches(asset.kind)).length === 0 ? (
            <Empty text="将文件拖至此处添加" />
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {uploads.map((item) => (
                <div
                  key={item.key}
                  style={{ aspectRatio: aspect }}
                  className="bg-muted relative grid place-items-center overflow-hidden rounded-lg text-center text-[11px]"
                >
                  {item.failed ? (
                    <button
                      type="button"
                      onClick={() => void upload(item)}
                      className="text-destructive flex flex-col items-center gap-1"
                    >
                      <RotateCcw className="size-4" />
                      上传失败
                    </button>
                  ) : (
                    <span className="text-muted-foreground flex flex-col items-center gap-1">
                      <Loader2 className="size-4 animate-spin" />
                      {item.progress}%
                    </span>
                  )}
                </div>
              ))}
              {imports
                .filter((asset) => matches(asset.kind))
                .map((asset) => (
                  <Tile
                    key={asset.id}
                    aspect={aspect}
                    readOnly={readOnly}
                    payload={{ type: "asset", asset }}
                    onAdd={onAdd}
                    title={asset.fileName ?? ""}
                    sub={
                      asset.kind === "image"
                        ? "图片"
                        : asset.durationMs
                          ? `${Math.round(asset.durationMs / 1000)}s`
                          : "视频"
                    }
                  >
                    <Thumb kind={asset.kind === "image" ? "image" : "video"} url={asset.url} />
                  </Tile>
                ))}
            </div>
          ))}
      </div>
    </aside>
  );
}

/** 空状态：一句话 */
function Empty({ text }: { text: string }) {
  return <p className="text-muted-foreground py-12 text-center text-[12.5px]">{text}</p>;
}

/** 图片或视频的封面 */
function Thumb({ kind, url }: { kind: "video" | "image"; url: string }) {
  if (kind === "video") return <VideoPoster src={url} />;
  return url ? (
    <img src={url} alt="" draggable={false} className="size-full object-cover" />
  ) : (
    <ImageIcon className="text-muted-foreground size-5" />
  );
}

/** 可拖进时间线的素材卡片 */
function Tile({
  aspect,
  readOnly,
  payload,
  onAdd,
  title,
  sub,
  badge = null,
  onTimeline = false,
  children,
}: {
  aspect: string;
  readOnly: boolean;
  payload: TimelineDragPayload;
  onAdd: (payload: TimelineDragPayload) => void;
  title: string;
  sub: string;
  badge?: string | null;
  onTimeline?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      draggable={!readOnly}
      onDragStart={(event) => startTimelineDrag(event, payload)}
      style={{ aspectRatio: aspect }}
      className={cn(
        "group bg-muted relative overflow-hidden rounded-lg ring-1 ring-transparent",
        !readOnly && "cursor-grab hover:ring-chrome-border active:cursor-grabbing",
      )}
    >
      {children}
      {badge && (
        <span className="bg-status-success absolute top-1 left-1 rounded px-1 text-[10px] font-semibold text-black">
          {badge}
        </span>
      )}
      {onTimeline && (
        <span className="absolute top-1 right-1 rounded bg-black/55 px-1 text-[10px] text-white">
          在轨上
        </span>
      )}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-4 pb-1 text-[10.5px] leading-tight text-white">
        <span className="block truncate">{title}</span>
        {sub && <span className="opacity-80">{sub}</span>}
      </span>
      {!readOnly && (
        <button
          type="button"
          aria-label="加到播放头所在段之后"
          title="加到播放头所在段之后"
          onClick={() => onAdd(payload)}
          className="absolute right-1 bottom-1 hidden size-5 place-items-center rounded-full bg-white/90 text-black group-hover:grid"
        >
          <Plus className="size-3" />
        </button>
      )}
    </div>
  );
}
