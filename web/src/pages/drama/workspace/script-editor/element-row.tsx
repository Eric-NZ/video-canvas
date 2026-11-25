import { memo } from "react";

import type { ScriptElementType } from "@/api/drama/type";
import { cn } from "@/lib/utils";
import { ELEMENT_LABEL, type EditorElement } from "@/utils/drama/script-doc";

import { EditableText } from "./editable-text";

/** 各类型空行时的占位提示 */
const PLACEHOLDER: Partial<Record<ScriptElementType, string>> = {
  action: "动作",
  parenthetical: "语气或同时发生的动作",
  dialogue: "台词",
  transition: "切至：",
  subtitle: "字幕内容",
  shot: "空镜画面",
  note: "备注，只有你看得到",
};

/** 各类型文字的版式（稿纸：剧本行业的排法，角色居中、对白收窄居中、括号再收窄、转场靠右） */
const TEXT_CLASS: Partial<Record<ScriptElementType, string>> = {
  action: "my-1",
  parenthetical:
    "mx-auto w-[46%] text-center text-[14.5px] text-muted-foreground not-empty:before:content-['（'] not-empty:after:content-['）'] max-sm:w-[80%]",
  dialogue: "mx-auto w-[60%] text-center max-sm:w-[86%]",
  transition:
    "text-right font-sans text-[13px] font-semibold tracking-[0.24em] text-muted-foreground",
  subtitle:
    "text-center font-sans text-[14px] text-status-info not-empty:before:text-muted-foreground not-empty:before:content-['字幕　']",
  shot: "not-empty:before:font-sans not-empty:before:text-[13px] not-empty:before:text-muted-foreground not-empty:before:content-['空镜　']",
  note: "my-1.5 rounded-none border-l-2 border-[oklch(0.76_0.12_305/0.3)] pl-3.5 font-sans text-[13px] leading-[1.8] text-[oklch(0.76_0.12_305)]",
};

/**
 * 页边的类型标签：贴在行的左侧页边外，悬停时淡出、光标在这一行时亮起，点开是类型菜单。
 * 按下时不抢走文字的焦点，改完类型光标还在这一行。
 */
function TypeTag({
  type,
  onOpen,
}: {
  type: ScriptElementType;
  onOpen: (anchor: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-type-menu
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onOpen(e.currentTarget)}
      className={cn(
        "text-muted-foreground absolute top-[0.4em] right-[calc(100%+18px)] inline-flex h-[22px] items-center rounded-full px-2 font-sans text-[11.5px] leading-none font-medium whitespace-nowrap opacity-0 transition-[opacity,background-color] duration-150 group-hover/row:opacity-60",
        "group-focus-within/row:bg-status-warning/15 group-focus-within/row:text-status-warning group-focus-within/row:opacity-100",
        "max-sm:top-auto max-sm:right-0 max-sm:bottom-full max-sm:h-5 max-sm:group-hover/row:opacity-0 max-sm:group-focus-within/row:opacity-100",
      )}
    >
      {ELEMENT_LABEL[type]}
    </button>
  );
}

/**
 * 剧本里的一行。角色行是人物选择按钮而不是文字，所以对白永远挂在说话人下面；
 * 闪回标记是分隔线。组件按行记忆，只有这一行变了才重绘。
 * @param el 这一行
 * @param sceneKey 所在场次的 key
 * @param editable 是否可编辑
 * @param characterName 角色行选中的人物正式名，没选是 null
 * @param unconfirmed 这个人物还是待确认状态
 * @param highlighted 高亮（点人物时亮出他的全部台词）
 * @param invalid 保存校验没过的行
 * @param onText 文字变化
 * @param onPick 打开人物选择，anchor 是被点的按钮
 * @param onExtension 切换画外音标记
 * @param onTypeMenu 点页边的类型标签，anchor 是被点的标签；不传（只读）就不显示标签
 */
export const ElementRow = memo(function ElementRow({
  el,
  sceneKey,
  editable,
  characterName,
  unconfirmed,
  highlighted,
  invalid,
  onText,
  onPick,
  onExtension,
  onTypeMenu,
}: {
  el: EditorElement;
  sceneKey: string;
  editable: boolean;
  characterName: string | null;
  unconfirmed: boolean;
  highlighted: boolean;
  invalid: boolean;
  onText: (sceneKey: string, elKey: string, text: string) => void;
  onPick: (sceneKey: string, elKey: string, anchor: HTMLElement) => void;
  onExtension: (sceneKey: string, elKey: string) => void;
  onTypeMenu?: (sceneKey: string, elKey: string, anchor: HTMLElement) => void;
}) {
  const tag = onTypeMenu && (
    <TypeTag type={el.type} onOpen={(anchor) => onTypeMenu(sceneKey, el.key, anchor)} />
  );
  const wrap = cn(
    "group/row relative rounded-md transition-colors",
    highlighted && "bg-status-warning/15",
    invalid && "bg-destructive/10 ring-destructive ring-1",
  );
  const common = { "data-el": el.key, "data-scene": sceneKey };

  if (el.type === "character") {
    return (
      <div {...common} className={cn(wrap, "mt-5 flex items-center justify-center gap-1")}>
        {tag}
        <button
          type="button"
          data-pick
          disabled={!editable}
          onClick={(e) => onPick(sceneKey, el.key, e.currentTarget)}
          className={cn(
            "hover:bg-chrome-hover focus-visible:bg-chrome-hover rounded-md py-0.5 pr-1 pl-2.5 font-sans text-[14px] font-semibold tracking-[0.32em] outline-none disabled:cursor-default disabled:hover:bg-transparent",
            !characterName && "text-muted-foreground/70 px-2 tracking-[0.1em] font-medium",
          )}
        >
          {characterName ?? "选择人物"}
        </button>
        {unconfirmed && <span className="bg-status-info size-1.5 rounded-full" title="待确认" />}
        {(editable || el.extension) && (
          <button
            type="button"
            disabled={!editable}
            title="画外音 / 内心独白"
            onClick={() => onExtension(sceneKey, el.key)}
            className={cn(
              "rounded-full px-1.5 font-mono text-[11px] disabled:cursor-default",
              el.extension
                ? "bg-status-warning/15 text-status-warning"
                : "text-muted-foreground/60 hover:bg-chrome-hover",
            )}
          >
            {el.extension || "OS/VO"}
          </button>
        )}
      </div>
    );
  }

  if (el.type === "flashback_start" || el.type === "flashback_end") {
    return (
      <div {...common} className={wrap}>
        <div
          data-focusable
          tabIndex={0}
          className="text-muted-foreground before:bg-border after:bg-border focus:text-status-warning my-4 flex items-center gap-3.5 font-sans text-xs tracking-[0.3em] outline-none before:h-px before:flex-1 after:h-px after:flex-1"
        >
          {el.type === "flashback_start" ? "闪回" : "闪回结束"}
        </div>
      </div>
    );
  }

  return (
    <div {...common} className={wrap}>
      {tag}
      <EditableText
        value={el.text}
        editable={editable}
        placeholder={PLACEHOLDER[el.type] ?? ""}
        onInput={(text) => onText(sceneKey, el.key, text)}
        className={TEXT_CLASS[el.type]}
      />
    </div>
  );
});
