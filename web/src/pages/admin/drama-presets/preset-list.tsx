import { useState } from "react";
import { Reorder, useDragControls } from "motion/react";
import { GripVertical, Pencil, Trash2 } from "lucide-react";

import type { DramaPresetAdminItem } from "@/api/admin/drama-preset/type";
import { Tag } from "@/components/admin-ui/tag";
import { DramaPoster } from "@/components/drama/poster";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * 一行预设：拖动手柄、缩略图（仅画风）、名称与 key、描述首行摘要、启用开关、编辑、删除。
 * 只有手柄能拖动，免得点开关、选文字时误触发排序。停用的行名称半透明。
 * 有短剧在用的条目删不掉（后端会拒），这里直接把删除按钮禁用并把原因写在 title 上。
 */
function PresetRow({
  item,
  busy,
  deleting,
  onDragEnd,
  onToggle,
  onEdit,
  onRemove,
}: {
  item: DramaPresetAdminItem;
  busy: boolean;
  /** 仅 super_admin 能删；false 时按钮禁用 */
  deleting: boolean;
  onDragEnd: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();
  const used = item.project_count > 0;
  const removeReason = !deleting
    ? "只有超级管理员能删除预设"
    : used
      ? `已有 ${item.project_count} 部短剧在用，只能停用`
      : "删除";

  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      className={cn(
        "hover:bg-muted group/row relative flex items-center gap-3 rounded-[10px] p-2 transition-colors duration-120 max-md:flex-wrap",
        busy && "pointer-events-none opacity-50",
      )}
    >
      <button
        type="button"
        aria-label="拖动排序"
        title="拖动排序"
        onPointerDown={(event) => controls.start(event)}
        className="text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-ring/50 grid h-8 w-5 shrink-0 cursor-grab touch-none place-items-center rounded-md outline-none focus-visible:ring-2 active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>

      {item.kind === "style" && (
        <DramaPoster seed={item.key} className="aspect-16/10 w-20 shrink-0 rounded-md">
          {item.preview_url && (
            <img
              src={item.preview_url}
              alt={`${item.name}预览`}
              width={640}
              height={400}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
          )}
        </DramaPoster>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className={cn("truncate text-sm font-medium", !item.enabled && "opacity-50")}>
            {item.name}
          </p>
          <Tag mono className="shrink-0">
            {item.key}
          </Tag>
          {!item.enabled && (
            <Tag tone="warning" className="shrink-0">
              已停用
            </Tag>
          )}
        </div>
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
          {item.prompt && <span className="truncate">{item.prompt}</span>}
          <span className="shrink-0 tabular-nums">
            {used ? `${item.project_count} 部短剧在用` : "暂无短剧使用"}
          </span>
        </div>
      </div>

      <Switch
        checked={item.enabled}
        disabled={busy}
        title={item.enabled ? "已启用" : "未启用"}
        aria-label="启用"
        onCheckedChange={onToggle}
      />
      <div className="flex shrink-0 gap-0.5">
        <Button variant="ghost" size="icon" aria-label="编辑" title="编辑" onClick={onEdit}>
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="删除"
          title={removeReason}
          disabled={!deleting || used}
          className="hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
    </Reorder.Item>
  );
}

/**
 * 预设列表（motion 的 Reorder，和公告、登录页展示同一套）：拖动时只改本地顺序，松手才提交；
 * 服务端的列表变了（新增、删除、重新拉取）就以服务端为准。
 */
export function PresetList({
  items,
  busyIds,
  canDelete,
  onReorder,
  onToggle,
  onEdit,
  onRemove,
}: {
  items: DramaPresetAdminItem[];
  busyIds: ReadonlySet<number>;
  canDelete: boolean;
  onReorder: (items: DramaPresetAdminItem[]) => void;
  onToggle: (item: DramaPresetAdminItem) => void;
  onEdit: (item: DramaPresetAdminItem) => void;
  onRemove: (item: DramaPresetAdminItem) => void;
}) {
  const [local, setLocal] = useState(items);
  const [prevItems, setPrevItems] = useState(items);

  /** 服务端的列表变了就重置本地顺序（在渲染里同步，不在 effect 里，免得闪一帧旧顺序） */
  if (items !== prevItems) {
    setPrevItems(items);
    setLocal(items);
  }

  /** 松手：顺序真的变了才提交 */
  const commit = () => {
    const changed = local.some((item, index) => item.id !== items[index]?.id);
    if (changed) onReorder(local);
  };

  return (
    <Reorder.Group axis="y" values={local} onReorder={setLocal} className="m-0 list-none p-1.5">
      {local.map((item) => (
        <PresetRow
          key={item.id}
          item={item}
          busy={busyIds.has(item.id)}
          deleting={canDelete}
          onDragEnd={commit}
          onToggle={() => onToggle(item)}
          onEdit={() => onEdit(item)}
          onRemove={() => onRemove(item)}
        />
      ))}
    </Reorder.Group>
  );
}
