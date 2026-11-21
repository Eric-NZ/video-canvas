import { Trash2 } from "lucide-react";

import type { ScriptIntExt } from "@/api/drama/type";
import { cn } from "@/lib/utils";
import type { EditorScene } from "@/utils/drama/script-doc";

/** 内外景选项 */
const INT_EXT: { value: ScriptIntExt; label: string }[] = [
  { value: "", label: "内/外" },
  { value: "interior", label: "内" },
  { value: "exterior", label: "外" },
  { value: "interior_exterior", label: "内外" },
];

/** 时间选项；后端接受任意文本，这里给常用的几个 */
const TIMES = ["", "日", "夜", "清晨", "黄昏"];

const PILL =
  "bg-chrome-hover ring-chrome-border text-paper-foreground h-7 cursor-pointer appearance-none rounded-full px-3 text-[13px] font-semibold ring-1 outline-none disabled:cursor-default disabled:bg-transparent disabled:px-0.5 disabled:ring-0";

/**
 * 场次标题：场号 + 时间 + 内外景 + 地点。场号由顺序推出；地点来自地点表，点开选择或新建。
 * @param scene 这一场
 * @param label 场号，如 "3-1"
 * @param locationName 地点正式名，没选是 null
 * @param unconfirmed 地点还是待确认状态
 * @param editable 是否可编辑
 * @param canDelete 是否允许删除这一场（至少保留一场）
 * @param onChange 改内外景、时间
 * @param onPickLocation 打开地点选择，anchor 是被点的按钮
 * @param onDelete 删除这一场
 */
export function SceneHeading({
  scene,
  label,
  locationName,
  unconfirmed,
  editable,
  canDelete,
  onChange,
  onPickLocation,
  onDelete,
}: {
  scene: EditorScene;
  label: string;
  locationName: string | null;
  unconfirmed: boolean;
  editable: boolean;
  canDelete: boolean;
  onChange: (patch: Partial<EditorScene>) => void;
  onPickLocation: (anchor: HTMLElement) => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-scene-heading={scene.key}
      className="hover:bg-chrome-hover/60 group -mx-2 mb-2.5 flex flex-wrap items-center gap-1.5 rounded-xl px-2 py-1.5 font-sans"
    >
      <span className="text-status-warning min-w-9 font-mono text-[13px] font-semibold">
        {label}
      </span>
      <select
        aria-label="时间"
        disabled={!editable}
        value={TIMES.includes(scene.timeLabel) ? scene.timeLabel : "__custom"}
        onChange={(e) => onChange({ timeLabel: e.target.value })}
        className={PILL}
      >
        {TIMES.map((t) => (
          <option key={t} value={t}>
            {t || "时间"}
          </option>
        ))}
        {!TIMES.includes(scene.timeLabel) && <option value="__custom">{scene.timeLabel}</option>}
      </select>
      <select
        aria-label="内外景"
        disabled={!editable}
        value={scene.intExt}
        onChange={(e) => onChange({ intExt: e.target.value as ScriptIntExt })}
        className={PILL}
      >
        {INT_EXT.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="text-muted-foreground">·</span>
      <button
        type="button"
        disabled={!editable}
        onClick={(e) => onPickLocation(e.currentTarget)}
        className={cn(PILL, !locationName && "text-muted-foreground font-medium")}
      >
        {locationName ?? "选择地点"}
      </button>
      {unconfirmed && <span className="bg-status-info size-1.5 rounded-full" title="待确认" />}
      <span className="flex-1" />
      {editable && canDelete && (
        <button
          type="button"
          title="删除这一场"
          onClick={onDelete}
          className="text-muted-foreground hover:bg-chrome-hover hover:text-destructive grid size-7 place-items-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}
