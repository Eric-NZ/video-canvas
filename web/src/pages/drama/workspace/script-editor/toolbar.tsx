import { Plus } from "lucide-react";

import type { ScriptElementType } from "@/api/drama/type";
import { cn } from "@/lib/utils";
import { CYCLE_TYPES, ELEMENT_LABEL, canType, type EditorElement } from "@/utils/drama/script-doc";

/**
 * 元素工具条：当前行的类型高亮；不合法的类型置灰，原因放在悬停提示里。
 * 贴在稿纸顶上，滚动时一直在。
 * @param els 光标所在场次的全部行
 * @param index 光标所在行
 * @param readOnly 已锁定
 * @param onType 改当前行的类型
 * @param onMarker 在当前行后插入闪回标记
 * @param onNewScene 在当前场后新建一场
 */
export function ElementToolbar({
  els,
  index,
  readOnly,
  onType,
  onMarker,
  onNewScene,
}: {
  els: EditorElement[];
  index: number;
  readOnly: boolean;
  onType: (type: ScriptElementType) => void;
  onMarker: (type: ScriptElementType) => void;
  onNewScene: () => void;
}) {
  const current = els[index]?.type;
  const base =
    "h-8 shrink-0 rounded-full px-3 text-[12.5px] font-medium whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="sticky top-3 z-20 -mt-4 mb-4 flex justify-center">
      <div
        role="toolbar"
        aria-label="剧本元素"
        className="bg-chrome ring-chrome-border flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full p-1 shadow-lg ring-1 backdrop-blur-xl backdrop-saturate-150"
      >
        {CYCLE_TYPES.map((type) => {
          const why = readOnly ? "剧本已锁定" : canType(els, index, type);
          return (
            <button
              key={type}
              type="button"
              disabled={!!why}
              title={why || ELEMENT_LABEL[type]}
              aria-pressed={current === type}
              // 按下时不抢走输入框的焦点，改完类型光标还在这一行
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onType(type)}
              className={cn(
                base,
                current === type
                  ? "bg-chrome-hover ring-chrome-border ring-1"
                  : "text-muted-foreground hover:bg-chrome-hover hover:text-foreground",
              )}
            >
              {ELEMENT_LABEL[type]}
            </button>
          );
        })}
        <span className="bg-chrome-border mx-1 h-4 w-px shrink-0" />
        {(["flashback_start", "flashback_end"] as const).map((type) => (
          <button
            key={type}
            type="button"
            disabled={readOnly}
            title={readOnly ? "剧本已锁定" : `在这一行后插入「${ELEMENT_LABEL[type]}」`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onMarker(type)}
            className={cn(
              base,
              "text-muted-foreground hover:bg-chrome-hover hover:text-foreground",
            )}
          >
            {ELEMENT_LABEL[type]}
          </button>
        ))}
        <span className="bg-chrome-border mx-1 h-4 w-px shrink-0" />
        <button
          type="button"
          disabled={readOnly}
          title={readOnly ? "剧本已锁定" : "在这一场后新建一场（⌘/Ctrl + Enter）"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onNewScene}
          className={cn(
            base,
            "text-muted-foreground hover:bg-chrome-hover hover:text-foreground inline-flex items-center gap-1",
          )}
        >
          <Plus className="size-3.5" />
          场次
        </button>
      </div>
    </div>
  );
}
