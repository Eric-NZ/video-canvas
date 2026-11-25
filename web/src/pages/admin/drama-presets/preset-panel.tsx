import { useState } from "react";
import { Clapperboard, Plus } from "lucide-react";

import type { DramaPresetAdminItem, DramaPresetKind } from "@/api/admin/drama-preset/type";
import { confirm } from "@/components/admin-ui/confirm-dialog";
import {
  EmptyState,
  EmptyStateActions,
  EmptyStateIcon,
  EmptyStateTitle,
} from "@/components/admin-ui/empty-state";
import { GLASS_PANEL } from "@/components/admin-ui/glass";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { KIND_LABEL } from "@/utils/admin/drama-preset";

import { SettingsError } from "../settings/settings-state";
import { PresetDialog } from "./preset-dialog";
import { PresetList } from "./preset-list";
import { usePresetsAdmin } from "./use-presets-admin";

/** 弹窗的状态：关闭、新建（item 为 null）、编辑某一条 */
type EditorState = { open: false } | { open: true; item: DramaPresetAdminItem | null };

/**
 * 一个种类的预设清单：加载、拖动排序、启停、编辑、删除 + 新建 / 编辑弹窗。
 *
 * 由页面用 key={kind} 挂载：切到另一个种类时整块重挂载，列表与加载状态自然回到初始值，
 * 不需要在 effect 里手动清空（那样会多一次渲染，也容易出现「上一个种类的行闪一下」）。
 * @param kind 题材 / 画风
 * @param canDelete 是否允许删除（只有 super_admin）
 */
export function PresetPanel({ kind, canDelete }: { kind: DramaPresetKind; canDelete: boolean }) {
  const admin = usePresetsAdmin(kind);
  const [editor, setEditor] = useState<EditorState>({ open: false });
  const { items, status } = admin;

  const openNew = () => setEditor({ open: true, item: null });
  const askRemove = (item: DramaPresetAdminItem) =>
    void confirm({
      title: `删除这个${KIND_LABEL[item.kind]}？`,
      description: `「${item.name}」删除后开拍设置里不再出现，操作审计里会留下记录。`,
      confirmLabel: "删除",
      destructive: true,
      onConfirm: () => admin.remove(item),
    });

  return (
    <>
      {/* 工具条：条数与新建入口。空列表时下面还有一个新建按钮，两处都留是为了不让空状态只剩一行字 */}
      {status === "ready" && items.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            共 {items.length} 条，拖动左侧手柄可调整顺序
          </p>
          <Button size="sm" onClick={openNew}>
            <Plus />
            新建{KIND_LABEL[kind]}
          </Button>
        </div>
      )}
      {status === "loading" && <Skeleton className="h-60 w-full rounded-xl" />}
      {status === "error" && <SettingsError onRetry={() => void admin.reload()} />}
      {status === "ready" && (
        <Card className={cn(GLASS_PANEL, "gap-0 py-0")}>
          {items.length === 0 ? (
            <EmptyState className="m-4 border-0">
              <EmptyStateIcon>
                <Clapperboard />
              </EmptyStateIcon>
              <EmptyStateTitle>还没有{KIND_LABEL[kind]}</EmptyStateTitle>
              <EmptyStateActions>
                <Button onClick={openNew}>
                  <Plus />
                  新建{KIND_LABEL[kind]}
                </Button>
              </EmptyStateActions>
            </EmptyState>
          ) : (
            <PresetList
              items={items}
              busyIds={admin.busyIds}
              canDelete={canDelete}
              onReorder={(next) => void admin.reorder(next).catch(() => undefined)}
              onToggle={(item) => void admin.toggleEnabled(item)}
              onEdit={(item) => setEditor({ open: true, item })}
              onRemove={askRemove}
            />
          )}
        </Card>
      )}

      <PresetDialog
        open={editor.open}
        item={editor.open ? editor.item : null}
        kind={kind}
        onClose={() => setEditor({ open: false })}
        onSaved={() => void admin.reload()}
      />
    </>
  );
}
