import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";

import {
  createDramaPreset,
  updateDramaPreset,
  uploadDramaPresetPreview,
} from "@/api/admin/drama-preset";
import type { DramaPresetAdminItem, DramaPresetKind } from "@/api/admin/drama-preset/type";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/admin-ui/dialog";
import { FormField } from "@/components/admin-ui/form-field";
import { DramaPoster } from "@/components/drama/poster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  KIND_LABEL,
  PRESET_NAME_MAX,
  PRESET_PROMPT_MAX,
  charCount,
  emptyPresetForm,
  formFromItem,
  validatePresetForm,
  validatePreviewFile,
  type PresetForm,
} from "@/utils/admin/drama-preset";

import { useAliveRef } from "../use-admin";

/**
 * 新建 / 编辑预设的弹窗。
 *
 * key 只在新建时可填：短剧表里存的就是它，且没有外键，改了会静默切断历史项目。
 * 预览图分两步——新建时先存条目拿到 id，再把图传给 /:id/preview；编辑时直接传。
 * @param item 正在编辑的条目；null 表示新建
 * @param kind 当前种类（新建时用它决定有没有描述与预览图）
 * @param open 是否打开
 * @param onSaved 保存成功（调用方重新拉列表）
 */
export function PresetDialog({
  open,
  item,
  kind,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: DramaPresetAdminItem | null;
  kind: DramaPresetKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-[520px]">
        {/* 换一条预设或重新打开就换 key，表单状态整份重置 */}
        <DialogForm
          key={item?.id ?? `new-${kind}`}
          item={item}
          kind={item?.kind ?? kind}
          onClose={onClose}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

function DialogForm({
  item,
  kind,
  onClose,
  onSaved,
}: {
  item: DramaPresetAdminItem | null;
  kind: DramaPresetKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const aliveRef = useAliveRef();
  const editing = !!item;
  const [form, setForm] = useState<PresetForm>(() =>
    item ? formFromItem(item) : emptyPresetForm(),
  );
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validatePresetForm(form, kind, editing);
  const set = <K extends keyof PresetForm>(key: K, value: PresetForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /** 选中的本地图先预览（避免上传完才看到效果）；离开时释放 objectURL */
  const localUrl = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => {
    if (!localUrl) return;
    return () => URL.revokeObjectURL(localUrl);
  }, [localUrl]);
  const previewUrl = localUrl || form.previewUrl;

  const pickFile = (picked: File | null) => {
    setFileError(picked ? validatePreviewFile(picked) : null);
    setFile(picked && !validatePreviewFile(picked) ? picked : null);
  };

  const save = async () => {
    setTouched(true);
    if (Object.keys(errors).length > 0 || fileError) return;
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        ...(kind === "style" ? { prompt: form.prompt.trim() } : {}),
      };
      let id = item?.id;
      if (item) {
        await updateDramaPreset(item.id, body);
      } else {
        const created = await createDramaPreset({
          kind,
          key: form.key.trim(),
          ...body,
          // 预览图统一走上传接口（要拿到 id），手填地址的场景留给编辑弹窗
          enabled: form.enabled,
        });
        id = created.id;
      }
      // 预览图：拿到 id 之后再传，替换也走同一条接口
      if (id && file) await uploadDramaPresetPreview(id, file);
      if (!aliveRef.current) return;
      onSaved();
      onClose();
    } catch {
      // 全局 toast 已弹（含后端给的具体原因），弹窗保持打开
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  };

  return (
    <form
      className="grid min-w-0 grid-cols-[minmax(0,1fr)]"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <DialogHeader className="px-6 pt-6 pb-4">
        <DialogTitle>{editing ? `编辑${KIND_LABEL[kind]}` : `新建${KIND_LABEL[kind]}`}</DialogTitle>
        <DialogDescription className="sr-only">
          预设会出现在开拍设置的题材 / 画风清单里，画风的描述会注入每一步的生成提示词。
        </DialogDescription>
      </DialogHeader>

      <div className="grid max-h-[70svh] grid-cols-[minmax(0,1fr)] content-start gap-4.5 overflow-y-auto px-6 pb-6">
        <FormField
          label="标识（key）"
          htmlFor="preset-key"
          required
          error={touched && !editing ? errors.key : undefined}
          hint={
            editing
              ? "key 创建后不可改：已有短剧靠它关联这个预设"
              : "小写字母、数字、下划线，最长 32 位；创建后不可改，已有短剧靠它关联这个预设"
          }
        >
          <Input
            id="preset-key"
            className="font-mono"
            autoFocus={!editing}
            disabled={editing}
            value={form.key}
            aria-invalid={touched && !editing && !!errors.key}
            onChange={(event) => set("key", event.target.value)}
          />
        </FormField>

        <FormField
          label={
            <span className="flex w-full items-center justify-between">
              名称
              <span className="text-muted-foreground font-normal tabular-nums">
                {charCount(form.name.trim())}/{PRESET_NAME_MAX}
              </span>
            </span>
          }
          htmlFor="preset-name"
          required
          error={touched ? errors.name : undefined}
        >
          <Input
            id="preset-name"
            autoFocus={editing}
            value={form.name}
            aria-invalid={touched && !!errors.name}
            onChange={(event) => set("name", event.target.value)}
          />
        </FormField>

        {kind === "style" && (
          <>
            <FormField
              label={
                <span className="flex w-full items-center justify-between">
                  画风描述
                  <span className="text-muted-foreground font-normal tabular-nums">
                    {charCount(form.prompt.trim())}/{PRESET_PROMPT_MAX}
                  </span>
                </span>
              }
              htmlFor="preset-prompt"
              error={touched ? errors.prompt : undefined}
              hint="正向的视觉描述，会注入各步骤的提示词；画幅、时长、口型同步这些属于开拍设置，不要写进来"
            >
              <Textarea
                id="preset-prompt"
                rows={5}
                value={form.prompt}
                aria-invalid={touched && !!errors.prompt}
                onChange={(event) => set("prompt", event.target.value)}
              />
            </FormField>

            <FormField
              label="预览图"
              error={fileError ?? undefined}
              hint="640×400 效果最好，只收 WebP / PNG / JPEG，2MB 以内"
            >
              <div className="flex items-start gap-3">
                <DramaPoster seed={form.key || "preset"} className="aspect-16/10 w-32 rounded-lg">
                  {previewUrl && (
                    <img
                      src={previewUrl}
                      alt="预览图"
                      width={640}
                      height={400}
                      className="absolute inset-0 size-full object-cover"
                    />
                  )}
                </DramaPoster>
                <div className="flex min-w-0 flex-col gap-2">
                  {/* 原生 file 输入藏起来，用按钮触发：Button 没有 asChild，套 label 容易和键盘操作打架 */}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/webp,image/png,image/jpeg"
                    className="sr-only"
                    onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                  >
                    <ImagePlus />
                    {previewUrl ? "替换图片" : "选择图片"}
                  </Button>
                  {file && <p className="text-muted-foreground truncate text-xs">{file.name}</p>}
                  <p className="text-muted-foreground text-xs">
                    保存时才会上传，图片会落到平台存储并生成长地址
                  </p>
                </div>
              </div>
            </FormField>
          </>
        )}

        {!editing && (
          <label className="flex items-center justify-between gap-3 py-1.5 text-sm font-medium">
            启用
            <Switch checked={form.enabled} onCheckedChange={(checked) => set("enabled", checked)} />
          </label>
        )}
      </div>

      <DialogFooter className="m-0 rounded-b-3xl">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          取消
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          保存
        </Button>
      </DialogFooter>
    </form>
  );
}
