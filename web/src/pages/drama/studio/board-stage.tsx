import { CircleX, Film, Grid2x2, RotateCw } from "lucide-react";

import { TaskGenerationStatus } from "@/components/generation-status";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BOARD_RATIO } from "@/utils/drama/board";
import { playableTake } from "@/utils/drama/segments";

import { useStudio, type PreviewView } from "./use-studio";

/** 胶囊外观：清透底 + 细描边（同工作台其他浮在内容上的控件） */
const PILL =
  "bg-chrome ring-chrome-border flex items-center gap-0.5 rounded-full p-0.5 shadow-lg ring-1 backdrop-blur-xl backdrop-saturate-150";
const PILL_BUTTON =
  "text-muted-foreground hover:bg-chrome-hover hover:text-foreground focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] whitespace-nowrap outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4";

/** 状态小点 / 标签：好了绿点，过期 / 失败写字，生成中转圈 */
function StateMark({ state }: { state: "ok" | "none" | "stale" | "failed" | "running" }) {
  if (state === "running") {
    return <span className="bg-primary size-1.5 animate-pulse rounded-full" />;
  }
  if (state === "stale" || state === "failed") {
    return (
      <span
        className={cn(
          "rounded-full px-1.5 text-[10.5px] leading-4",
          state === "stale" ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive",
        )}
      >
        {state === "stale" ? "过期" : "失败"}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "size-1.5 rounded-full",
        state === "ok" ? "bg-emerald-400" : "bg-muted-foreground/40",
      )}
    />
  );
}

/** 预览顶部的「故事板 | 视频」切换：一个片段先定故事板再出视频，两面各带状态 */
export function ViewSwitch() {
  const { selected, submitting, boards, view, setView } = useStudio();
  if (!selected) return null;
  const board = boards.statusOf(selected);
  const videoRunning = selected.status === "running" || submitting.has(selected.id);
  const items: { key: PreviewView; label: string; icon: React.ReactNode; mark: React.ReactNode }[] =
    [
      {
        key: "board",
        label: "故事板",
        icon: <Grid2x2 />,
        mark: (
          <StateMark
            state={
              board === "ready"
                ? "ok"
                : board === "empty"
                  ? "none"
                  : board === "stale"
                    ? "stale"
                    : board === "failed"
                      ? "failed"
                      : "running"
            }
          />
        ),
      },
      {
        key: "video",
        label: "视频",
        icon: <Film />,
        mark: (
          <StateMark state={videoRunning ? "running" : playableTake(selected) ? "ok" : "none"} />
        ),
      },
    ];
  return (
    <div role="radiogroup" aria-label="预览" className={PILL}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="radio"
          aria-checked={view === item.key}
          onClick={() => setView(item.key)}
          className={cn(
            PILL_BUTTON,
            view === item.key && "bg-chrome-hover text-foreground ring-chrome-border ring-1",
          )}
        >
          {item.icon}
          {item.label}
          {item.mark}
        </button>
      ))}
    </div>
  );
}

/**
 * 预览的「故事板」一面：选中片段的 16:9 宫格图，按状态显示——已出图（过期时左上角提示重新生成）、生成中、失败、还没有；
 * 下面是镜头数 / 宫格、重新生成、进入画布查看（看大图、切换历史版本）。
 */
export function BoardStage() {
  const { selected, boards, openBoardInCanvas } = useStudio();
  if (!selected) return null;
  const status = boards.statusOf(selected);
  const node = boards.nodeOf(selected);
  const credits = boards.credits > 0 ? boards.credits : null;
  const blocked = boards.blocked ?? (!selected.prompt.trim() ? "片段原稿是空的" : null);
  const generate = () => void boards.generate([selected]);
  const generateLabel = (text: string) => (
    <>
      {text}
      {credits && <span className="tabular-nums opacity-60">· {credits}</span>}
    </>
  );
  const hasImage = (status === "ready" || status === "stale") && !!node?.src;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3">
      <div
        data-slot="board-frame"
        style={{ aspectRatio: BOARD_RATIO.replace(":", "/") }}
        className={cn(
          "relative grid max-h-full w-full max-w-[860px] place-items-center overflow-hidden rounded-2xl [corner-shape:squircle]",
          hasImage || status === "running"
            ? "bg-black shadow-[0_40px_80px_-30px_rgb(0_0_0/0.9)] ring-1 ring-white/10"
            : cn(
                "border-[1.5px] border-dashed",
                status === "failed" ? "border-destructive/50" : "border-white/15",
              ),
        )}
      >
        {status === "running" ? (
          <TaskGenerationStatus className="size-full" />
        ) : hasImage ? (
          <>
            <img
              src={node.src ?? undefined}
              alt={`片段 ${selected.seq + 1} 的故事板`}
              className="size-full object-contain"
            />
            {status === "stale" && (
              <div className="text-primary absolute top-3 left-3 flex h-7 items-center gap-1.5 rounded-full bg-black/70 py-0 pr-1 pl-3 text-[12.5px] ring-1 ring-amber-400/35 backdrop-blur-md">
                原稿已改
                <button
                  type="button"
                  disabled={!!blocked}
                  title={blocked ?? undefined}
                  onClick={generate}
                  className="bg-primary text-primary-foreground h-5 rounded-full px-2.5 text-xs font-semibold disabled:opacity-50"
                >
                  重新生成
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <span
              className={cn(
                "bg-muted grid size-14 place-items-center rounded-[18px] [&_svg]:size-6",
                status === "failed" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {status === "failed" ? <CircleX /> : <Grid2x2 />}
            </span>
            <h3
              className={cn("text-[15px] font-semibold", status === "failed" && "text-destructive")}
            >
              {status === "failed" ? "生成失败" : "还没有故事板"}
            </h3>
            {status === "failed" && node?.error && (
              <p className="text-muted-foreground -mt-1.5 text-[13px]">{node.error}</p>
            )}
            <div className={PILL}>
              <button
                type="button"
                className={PILL_BUTTON}
                disabled={!!blocked}
                title={blocked ?? undefined}
                onClick={generate}
              >
                {generateLabel(status === "failed" ? "重新生成" : "生成")}
              </button>
            </div>
          </div>
        )}
      </div>

      {hasImage && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {node.shotCount > 0 && (
            <span className="text-muted-foreground text-xs tabular-nums">
              {node.shotCount} 镜 · {node.layout.replace("x", "×")} · {BOARD_RATIO}
            </span>
          )}
          <div className={PILL}>
            <button
              type="button"
              className={PILL_BUTTON}
              disabled={!!blocked}
              title={blocked ?? undefined}
              onClick={generate}
            >
              <RotateCw />
              {generateLabel("重新生成")}
            </button>
          </div>
          <div className={PILL}>
            <button
              type="button"
              className={PILL_BUTTON}
              onClick={() => openBoardInCanvas(node.nodeId)}
            >
              进入画布查看
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 片场顶部条的「补齐故事板 · n」（样式同「批量生成脚本」）：一次补完缺的、失败的和过期的，n 是还要补的张数 */
export function BoardProgress() {
  const { segments, boards } = useStudio();
  if (segments.length === 0) return null;
  const todo = boards.targets.length;
  const blocked = boards.blocked ?? (todo === 0 ? "每个片段都有可用的故事板" : null);
  return (
    <Button
      variant="outline"
      size="sm"
      data-slot="board-fill"
      disabled={!!blocked}
      title={
        blocked ?? `生成缺的、失败的和已过期的故事板（已可用 ${boards.ready}/${segments.length}）`
      }
      onClick={() => void boards.fill()}
    >
      补齐故事板
      {todo > 0 && <span className="tabular-nums opacity-60">· {todo}</span>}
    </Button>
  );
}
