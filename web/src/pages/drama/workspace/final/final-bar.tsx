import { useState } from "react";
import {
  Check,
  ChevronDown,
  Combine,
  Download,
  Loader2,
  LocateFixed,
  RefreshCw,
  Undo2,
} from "lucide-react";

import type { DramaJob, Segment } from "@/api/drama/type";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { SyncItem } from "@/store/drama-timeline";
import type { AutosaveStatus } from "@/utils/drama/autosave";
import type { FinalState } from "@/utils/drama/compose";
import { changeText } from "@/utils/drama/timeline";

/** 毫秒写成 mm:ss */
const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * 成片剪辑台顶栏：集标题、成片状态、片场同步胶囊、统计、下载和合成。
 * 原来右侧的合成面板收进这一行，剪辑区的尺寸不随提示变化。
 */
export function FinalBar({
  no,
  title,
  state,
  save,
  sync,
  segments,
  adopted,
  timelineMs,
  running,
  composing,
  composeReason,
  hasFinal,
  saving,
  readOnly,
  onRetrySave,
  onLocate,
  onAckSync,
  onUndoSync,
  onDownload,
  onCompose,
}: {
  no: number;
  title: string;
  state: FinalState;
  save: AutosaveStatus;
  sync: readonly SyncItem[];
  segments: readonly Segment[];
  adopted: number;
  timelineMs: number;
  running: DramaJob | null;
  composing: boolean;
  composeReason: string | null;
  hasFinal: boolean;
  saving: boolean;
  readOnly: boolean;
  onRetrySave: () => void;
  onLocate: (clipId: string) => void;
  onAckSync: () => void;
  onUndoSync: () => void;
  onDownload: () => void;
  onCompose: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-14 items-center gap-2.5 px-6 py-2.5">
      <h2 className="font-display truncate text-[17px] font-bold tracking-wide">
        第 {no} 集 · {title}
      </h2>
      {state !== "none" && (
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium",
            state === "stale"
              ? "bg-primary/15 text-primary"
              : "bg-status-success/15 text-status-success",
          )}
        >
          {state === "stale" ? "成片已过期，可重新合成" : "成片已合成"}
        </span>
      )}
      {save === "error" && !readOnly && (
        <button
          type="button"
          onClick={onRetrySave}
          className="text-destructive shrink-0 text-xs hover:underline"
        >
          时间线保存失败 · 重试
        </button>
      )}
      {sync.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-sky-500/15 px-2.5 text-xs font-medium text-sky-500 transition-colors hover:bg-sky-500/25"
              />
            }
          >
            <RefreshCw className="size-3" />
            片场更新 {sync.length}
            <ChevronDown className="size-3" />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={8}
            className="bg-chrome ring-chrome-border w-80 gap-0 rounded-2xl p-2 shadow-lg ring-1 backdrop-blur-xl backdrop-saturate-150"
          >
            <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11.5px]">已按片场自动同步</p>
            {sync.map((item, index) => {
              const locatable = !!item.clip;
              return (
                <button
                  key={`${item.change.segmentId}-${item.change.kind}-${index}`}
                  type="button"
                  disabled={!locatable}
                  onClick={() => {
                    if (!item.clip) return;
                    setOpen(false);
                    onLocate(item.clip.id);
                  }}
                  className="hover:bg-chrome-hover flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-[12.5px] disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      locatable ? "bg-sky-500" : "bg-muted-foreground",
                    )}
                  />
                  <span className={cn("flex-1", !locatable && "text-muted-foreground")}>
                    {changeText(item.change, segments, item.clip)}
                  </span>
                  {locatable && <LocateFixed className="text-muted-foreground size-3.5" />}
                </button>
              );
            })}
            <div className="border-chrome-border mt-1.5 flex items-center gap-2 border-t px-1 pt-2">
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    onUndoSync();
                  }}
                >
                  <Undo2 />
                  撤销同步
                </Button>
              )}
              <span className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onAckSync();
                }}
              >
                知道了
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
      <span className="flex-1" />
      <span className="bg-chrome-hover text-muted-foreground inline-flex shrink-0 items-baseline gap-1.5 rounded-full px-3 py-1 text-xs">
        <b className="text-foreground font-mono text-[13px]">
          {adopted}/{segments.length}
        </b>
        已采用
      </span>
      <span className="bg-chrome-hover text-muted-foreground inline-flex shrink-0 items-baseline gap-1.5 rounded-full px-3 py-1 text-xs">
        <b className="text-foreground font-mono text-[13px]">{mmss(timelineMs)}</b>
        时间线
      </span>
      {hasFinal && (
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={saving}
          onClick={onDownload}
        >
          {saving ? <Loader2 className="animate-spin" /> : <Download />}
          下载 mp4
        </Button>
      )}
      {!readOnly &&
        (running ? (
          <div className="w-44 shrink-0">
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-primary font-medium">正在合成…</span>
              <span className="font-mono">{running.progress}%</span>
            </div>
            <div className="bg-muted h-1 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-[width] duration-300"
                style={{ width: `${running.progress}%` }}
              />
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant={state === "fresh" ? "outline" : "default"}
            className="rounded-full"
            disabled={!!composeReason || composing}
            title={composeReason ?? "按时间线裁剪并拼接，不扣积分"}
            onClick={onCompose}
          >
            {composing ? (
              <Loader2 className="animate-spin" />
            ) : state === "fresh" ? (
              <Check />
            ) : (
              <Combine />
            )}
            {state === "none" ? `合成第 ${no} 集` : "重新合成"}
          </Button>
        ))}
      {composeReason && !running && !readOnly && (
        <span className="text-muted-foreground max-w-44 shrink-0 text-[11.5px] leading-tight">
          {composeReason}
        </span>
      )}
    </div>
  );
}
