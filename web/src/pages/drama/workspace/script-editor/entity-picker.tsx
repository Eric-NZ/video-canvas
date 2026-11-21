import { useState } from "react";
import { Plus } from "lucide-react";

import type { ScriptEntityDto, ScriptEntityKind } from "@/api/drama/type";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent } from "@/components/ui/popover";

/** 正在选的是哪一项：角色行的人物，或场次的地点 */
export interface PickerTarget {
  /** 人物或地点 */
  kind: ScriptEntityKind;
  /** 所在场次的 key */
  sceneKey: string;
  /** 角色行的 key；选地点时没有 */
  elKey?: string;
  /** 弹层贴着谁；用函数时等到定位那一刻才去找元素 */
  anchor: HTMLElement | (() => HTMLElement | null) | null;
}

/** 选择框内容：每次打开都重新挂载，搜索词从头开始 */
function PickerBody({
  kind,
  entities,
  onPick,
  onCreate,
}: {
  kind: ScriptEntityKind;
  entities: ScriptEntityDto[];
  onPick: (id: string) => void;
  onCreate: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const name = query.trim();
  const exact = entities.some((e) => e.name === name || e.aliases.includes(name));
  const noun = kind === "character" ? "人物" : "地点";
  return (
    <Command shouldFilter className="bg-transparent">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={`${noun}名或别名`}
        autoFocus
      />
      <CommandList className="max-h-56">
        {entities.map((e) => (
          <CommandItem
            key={e.id}
            value={`${e.name} ${e.aliases.join(" ")}`}
            onSelect={() => onPick(e.id)}
          >
            <span className="truncate">{e.name}</span>
            {e.aliases.length > 0 && (
              <span className="text-muted-foreground truncate text-xs">{e.aliases.join("、")}</span>
            )}
            {!e.confirmed && <span className="bg-status-info ml-auto size-1.5 rounded-full" />}
          </CommandItem>
        ))}
        {name && !exact && (
          <CommandItem forceMount value={`__new ${name}`} onSelect={() => onCreate(name)}>
            <Plus className="size-4" />
            新建{noun}：{name}
          </CommandItem>
        )}
      </CommandList>
    </Command>
  );
}

/**
 * 人物 / 地点选择：贴着被点的按钮弹出，可按名字或别名搜索，搜不到可以直接新建。
 * @param target 正在选的目标；null 表示关闭
 * @param entities 对应的人物表或地点表
 * @param onPick 选了已有条目
 * @param onCreate 新建并选中
 * @param onClose 关闭（点外面或按 Esc）
 */
export function EntityPicker({
  target,
  entities,
  onPick,
  onCreate,
  onClose,
}: {
  target: PickerTarget | null;
  entities: ScriptEntityDto[];
  onPick: (target: PickerTarget, id: string) => void;
  onCreate: (target: PickerTarget, name: string) => void;
  onClose: () => void;
}) {
  return (
    <Popover open={!!target} onOpenChange={(open) => !open && onClose()}>
      <PopoverContent
        anchor={target?.anchor ?? undefined}
        align="center"
        className="bg-chrome ring-chrome-border w-60 rounded-2xl p-1.5 shadow-lg ring-1 backdrop-blur-xl backdrop-saturate-150"
      >
        {target && (
          <PickerBody
            key={`${target.sceneKey}:${target.elKey ?? "loc"}`}
            kind={target.kind}
            entities={entities}
            onPick={(id) => onPick(target, id)}
            onCreate={(name) => onCreate(target, name)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
