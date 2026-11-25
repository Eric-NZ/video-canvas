import { Check } from "lucide-react";

import type { ScriptElementType } from "@/api/drama/type";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CYCLE_TYPES, ELEMENT_LABEL, canType, type EditorElement } from "@/utils/drama/script-doc";
import { FLIP_COLLISION } from "./popup-flip";

/** 正在改类型的那一行 */
export interface TypeMenuTarget {
  /** 所在场次的 key */
  sceneKey: string;
  /** 这一行的 key */
  elKey: string;
  /** 弹层贴着的页边标签 */
  anchor: HTMLElement;
}

const ITEM =
  "hover:bg-chrome-hover focus-visible:bg-chrome-hover flex min-h-9 w-full items-center justify-between gap-3 rounded-xl px-2.5 text-left text-[13px] outline-none disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent";

/**
 * 类型菜单：点稿纸页边的类型标签弹出。改这一行的类型（不合法的置灰，原因在悬停提示里），
 * 也在这里插入闪回标记、新建一场——稿纸上没有常驻工具条。
 * @param target 正在改的行；null 表示关闭
 * @param els 这一行所在场次的全部行
 * @param onType 改类型
 * @param onMarker 在这一行后插入闪回标记
 * @param onNewScene 在这一场后新建一场
 * @param onClose 关闭
 */
export function TypeMenu({
  target,
  els,
  onType,
  onMarker,
  onNewScene,
  onClose,
}: {
  target: TypeMenuTarget | null;
  els: EditorElement[];
  onType: (index: number, type: ScriptElementType) => void;
  onMarker: (index: number, type: ScriptElementType) => void;
  onNewScene: () => void;
  onClose: () => void;
}) {
  const index = target ? els.findIndex((e) => e.key === target.elKey) : -1;
  const current = els[index]?.type;
  const run = (fn: () => void) => {
    onClose();
    fn();
  };
  return (
    <Popover open={!!target && index >= 0} onOpenChange={(open) => !open && onClose()}>
      <PopoverContent
        collisionAvoidance={FLIP_COLLISION}
        anchor={target?.anchor}
        align="start"
        sideOffset={6}
        className="bg-chrome ring-chrome-border max-h-(--available-height) w-44 gap-0 overflow-y-auto rounded-2xl p-1.5 font-sans shadow-lg ring-1 backdrop-blur-xl backdrop-saturate-150"
      >
        <div role="menu" aria-label="行的类型" className="grid gap-0.5">
          {CYCLE_TYPES.map((type) => {
            const why = index >= 0 ? canType(els, index, type) : "";
            return (
              <button
                key={type}
                type="button"
                role="menuitemradio"
                aria-checked={current === type}
                disabled={!!why}
                title={why || undefined}
                onClick={() => run(() => onType(index, type))}
                className={cn(ITEM, current === type && "text-status-warning font-medium")}
              >
                {ELEMENT_LABEL[type]}
                {current === type && <Check className="size-3.5" />}
              </button>
            );
          })}
          <div className="bg-chrome-border mx-1.5 my-1 h-px" />
          {(["flashback_start", "flashback_end"] as const).map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              onClick={() => run(() => onMarker(index, type))}
              className={ITEM}
            >
              插入「{ELEMENT_LABEL[type]}」
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => run(onNewScene)} className={ITEM}>
            新建一场
            <kbd className="text-muted-foreground font-mono text-[11px]">⌘↵</kbd>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
