import { useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";

import { createScriptEntity, deleteScriptEntity, updateScriptEntity } from "@/api/drama";
import type { ScriptEntityDto, ScriptEntityKind } from "@/api/drama/type";
import { DialogSession } from "@/components/dialog-session";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { ScriptEditorApi } from "./use-script-editor";

/** 一行人物 / 地点：名字、标签、出现的集，以及确认 / 改名 / 删除 */
function EntityRow({
  entity,
  kind,
  busy,
  onConfirm,
  onRename,
  onDelete,
}: {
  entity: ScriptEntityDto;
  kind: ScriptEntityKind;
  busy: boolean;
  onConfirm: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entity.name);
  const submit = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== entity.name) onRename(name.trim());
    else setName(entity.name);
  };
  return (
    <li className="hover:bg-chrome-hover group flex min-h-12 items-center gap-2.5 rounded-xl px-3 py-1.5">
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
          entity.canvasNodeId
            ? "bg-status-warning/15 text-status-warning"
            : "bg-muted text-muted-foreground",
        )}
      >
        {entity.name.slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            autoFocus
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") submit();
              if (e.key === "Escape") {
                setName(entity.name);
                setEditing(false);
              }
            }}
            className="bg-chrome-hover border-chrome-border h-8 rounded-full"
          />
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{entity.name}</span>
              {!entity.confirmed && (
                <span className="bg-status-info/15 text-status-info rounded-full px-1.5 text-[11px]">
                  待确认
                </span>
              )}
              {entity.canvasNodeId && (
                <span className="bg-status-warning/15 text-status-warning rounded-full px-1.5 text-[11px]">
                  已关联资产
                </span>
              )}
            </div>
            <div className="text-muted-foreground truncate text-xs">
              {entity.episodes.length > 0 ? `第 ${entity.episodes.join("、")} 集` : "暂未出现"}
              {kind === "character" && entity.lines > 0 && ` · ${entity.lines} 次发言`}
              {entity.aliases.length > 0 && ` · 别名 ${entity.aliases.join("、")}`}
            </div>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {!entity.confirmed && (
            <Button size="icon-sm" variant="ghost" disabled={busy} title="确认" onClick={onConfirm}>
              <Check />
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            title="改名"
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </Button>
          <Button size="icon-sm" variant="ghost" disabled={busy} title="删除" onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
  );
}

/** 一种实体（人物或地点）的列表和新增输入 */
function EntitySection({
  title,
  kind,
  entities,
  dramaId,
  editor,
  readOnly,
}: {
  title: string;
  kind: ScriptEntityKind;
  entities: ScriptEntityDto[];
  dramaId: string;
  editor: ScriptEditorApi;
  readOnly: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  /** 请求失败的提示由全局 toast 弹，这里只负责恢复 busy 和刷新表 */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      await editor.reloadEntities();
    }
  };
  return (
    <section>
      <h3 className="text-muted-foreground mb-1.5 px-3 text-xs font-medium tracking-wide">
        {title} {entities.length}
      </h3>
      <ul className="grid gap-0.5">
        {entities.map((entity) => (
          <EntityRow
            key={entity.id}
            entity={entity}
            kind={kind}
            busy={busy || readOnly}
            onConfirm={() =>
              void run(async () => {
                await updateScriptEntity(dramaId, kind, entity.id, { confirmed: true });
              })
            }
            // 改名会让后端重渲染未锁定集（revision 前进）：先存好未保存的改动，改完再对齐 revision
            onRename={(name) =>
              void run(() =>
                editor.around(async () => {
                  await updateScriptEntity(dramaId, kind, entity.id, { name });
                }),
              )
            }
            onDelete={() =>
              void run(async () => {
                await deleteScriptEntity(dramaId, kind, entity.id);
              })
            }
          />
        ))}
      </ul>
      {!readOnly && (
        <form
          className="mt-2 flex gap-2 px-3"
          onSubmit={(e) => {
            e.preventDefault();
            const name = draft.trim();
            if (!name) return;
            void run(async () => {
              await createScriptEntity(dramaId, kind, { name });
              setDraft("");
            });
          }}
        >
          <Input
            value={draft}
            maxLength={64}
            placeholder={`新增${kind === "character" ? "人物" : "地点"}`}
            onChange={(e) => setDraft(e.target.value)}
            className="bg-chrome-hover border-chrome-border h-9 rounded-full"
          />
          <Button
            type="submit"
            size="icon"
            variant="outline"
            disabled={busy || !draft.trim()}
            title="新增"
          >
            <Plus />
          </Button>
        </form>
      )}
    </section>
  );
}

/**
 * 人物与地点：这部短剧的剧本人物表和地点表。改名一处生效（旧名自动成为别名），
 * 解析剧本时自动登记的新名字标「待确认」，在这里确认；仍被剧本引用的不能删。
 * @param open 是否打开
 * @param onOpenChange 开关
 * @param dramaId 短剧 id
 * @param editor 剧本编辑器状态（人物表、地点表和改名时的保存对齐都经它）
 */
export function PeopleDialog({
  open,
  onOpenChange,
  dramaId,
  editor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dramaId: string;
  editor: ScriptEditorApi;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88svh,720px)] flex-col gap-3 sm:max-w-md">
        <DialogSession open={open}>
          <DialogHeader>
            <DialogTitle>人物与地点</DialogTitle>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto">
            <EntitySection
              title="人物"
              kind="character"
              entities={editor.characters}
              dramaId={dramaId}
              editor={editor}
              readOnly={false}
            />
            <EntitySection
              title="地点"
              kind="location"
              entities={editor.locations}
              dramaId={dramaId}
              editor={editor}
              readOnly={false}
            />
          </div>
        </DialogSession>
      </DialogContent>
    </Dialog>
  );
}
