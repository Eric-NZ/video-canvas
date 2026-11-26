import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  changeAdminPresetState,
  listAdminPresets,
  saveAdminPreset,
  type AdminPreset,
  type AdminPresetGroup,
  type PresetAction,
  type PresetInput,
  type PresetStatus,
} from "@/api/admin/drama-prompt-preset";
import { DRAMA_ERR, isDramaError } from "@/api/drama/errors";
import type { PromptStep } from "@/api/drama/type";
import { confirm } from "@/components/admin-ui/confirm-dialog";
import { LoadFailed } from "@/components/admin-ui/load-failed";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@/components/admin-ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PROMPT_STEPS } from "@/utils/drama/prompts";

import { PresetEditor, type PresetEdit } from "./preset-editor";

const statuses = { enabled: "已启用", disabled: "已停用", archived: "已归档" } as const;
const actions = { enable: "启用", disable: "停用", archive: "归档", default: "设为默认" } as const;

function PresetTable({
  group,
  filter,
  onEdit,
  onAction,
}: {
  group: AdminPresetGroup;
  filter: PresetStatus | "all";
  onEdit: (edit: PresetEdit) => void;
  onAction: (row: AdminPreset, action: PresetAction) => void;
}) {
  const rows = group.items.filter((item) => filter === "all" || item.status === filter);
  if (!rows.length)
    return (
      <p className="text-muted-foreground py-14 text-center text-sm">
        当前筛选没有提示词，请调整筛选条件。
      </p>
    );

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>模板名称</TableHead>
            <TableHead>用途</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>更新时间 / 操作者</TableHead>
            <TableHead>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isDefault = row.id === group.default_id;
            const available = row.status !== "archived";
            return (
              <TableRow key={row.id}>
                <TableCell className="min-w-32 whitespace-normal font-medium">
                  {row.name} {isDefault && <Badge>默认</Badge>}
                </TableCell>
                <TableCell className="text-muted-foreground min-w-32 max-w-72 whitespace-normal">
                  {row.description || "—"}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{statuses[row.status]}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {new Date(row.updated_at).toLocaleString()}
                  <br />
                  {row.updated_by ? `管理员 ${row.updated_by}` : "系统"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-0.5">
                    {available && (
                      <Button size="xs" variant="ghost" onClick={() => onEdit({ row })}>
                        编辑
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" onClick={() => onEdit({ row, copy: true })}>
                      复制
                    </Button>
                    {available && !isDefault && (
                      <>
                        {row.status === "enabled" && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => onAction(row, "default")}
                          >
                            设为默认
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            onAction(row, row.status === "enabled" ? "disable" : "enable")
                          }
                        >
                          {row.status === "enabled" ? "停用" : "启用"}
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => onAction(row, "archive")}>
                          归档
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function DramaPresetsPage() {
  const [step, setStep] = useState<PromptStep>("plan");
  const [filter, setFilter] = useState<PresetStatus | "all">("all");
  const [edit, setEdit] = useState<PresetEdit | null>(null);
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<{ request: number; groups: AdminPresetGroup[] | null }>();
  const reload = () => setRequest((value) => value + 1);

  useEffect(() => {
    let active = true;
    void listAdminPresets().then(
      (groups) => {
        if (active) setResult({ request, groups });
      },
      () => {
        if (active) setResult({ request, groups: null });
      },
    );
    return () => {
      active = false;
    };
  }, [request]);

  const loading = result?.request !== request;
  const group = result?.groups?.find((item) => item.step === step);
  const save = async (id: string | undefined, input: PresetInput) => {
    try {
      await saveAdminPreset(step, id, input);
      setEdit(null);
      reload();
      toast.success("提示词已保存");
    } catch (cause) {
      if (isDramaError(cause, DRAMA_ERR.presetChanged)) reload();
      throw cause;
    }
  };

  const onAction = (row: AdminPreset, action: PresetAction) => {
    if (!group) return;
    const current = group.items.find((item) => item.id === group.default_id);
    void confirm({
      title: `${actions[action]}「${row.name}」`,
      description:
        action === "default"
          ? `默认项：${current?.name ?? "—"} → ${row.name}。新项目将预选它，已建项目不变。`
          : action === "enable"
            ? "启用后，创作者可以选用这条提示词。"
            : "创作者不能再新选这条提示词，已建项目仍可沿用其快照。",
      confirmLabel: actions[action],
      destructive: action === "archive",
      onConfirm: async () => {
        try {
          await changeAdminPresetState(
            step,
            row.id,
            action,
            action === "default" ? group.revision : row.revision,
          );
          reload();
          toast.success(`已${actions[action]}`);
        } catch (cause) {
          reload();
          throw cause;
        }
      },
    });
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>短剧提示词</PageHeaderTitle>
          <p className="text-muted-foreground mt-1 text-sm">
            管理开拍设置里的内置提示词。每类保留一个已启用的默认项。
          </p>
        </PageHeaderHeading>
        <PageHeaderActions>
          {group?.original_body && (
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => setEdit({ copy: true, originalBody: group.original_body })}
            >
              复制原内置
            </Button>
          )}
          <Button disabled={!group || loading || !group.default_id} onClick={() => setEdit({})}>
            <Plus />
            新建提示词
          </Button>
        </PageHeaderActions>
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="提示词分类" className="flex flex-wrap gap-1">
          {PROMPT_STEPS.map(({ key, name }) => (
            <Button
              key={key}
              size="sm"
              variant="ghost"
              aria-pressed={key === step}
              className={cn("rounded-full", key === step && "bg-muted font-semibold")}
              onClick={() => {
                setStep(key);
                setFilter("all");
              }}
            >
              {name}
            </Button>
          ))}
        </div>
        <Select
          value={filter}
          onValueChange={(value) => setFilter(value as PresetStatus | "all")}
          items={{ all: "全部状态", ...statuses }}
        >
          <SelectTrigger aria-label="筛选状态">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {Object.entries(statuses).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {loading ? (
        <div
          role="status"
          className="text-muted-foreground flex justify-center gap-2 py-14 text-sm"
        >
          <Loader2 className="size-4 animate-spin" />
          正在加载提示词…
        </div>
      ) : !group ? (
        <LoadFailed onRetry={reload} />
      ) : !group.default_id ? (
        <p role="status" className="text-muted-foreground py-14 text-center text-sm">
          内置提示词管理暂未启用。
        </p>
      ) : (
        <PresetTable group={group} filter={filter} onEdit={setEdit} onAction={onAction} />
      )}
      {edit && <PresetEditor step={step} edit={edit} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  );
}
