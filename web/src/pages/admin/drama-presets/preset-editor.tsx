import { useState } from "react";
import { Loader2 } from "lucide-react";

import type { AdminPreset, PresetInput } from "@/api/admin/drama-preset";
import { dramaErrorMessage } from "@/api/drama/errors";
import type { PromptStep } from "@/api/drama/type";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/admin-ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { checkBoardTemplate } from "@/utils/drama/placeholders";
import { PROMPT_BODY_MAX, promptStepName } from "@/utils/drama/prompts";

export type PresetEdit = { row?: AdminPreset; copy?: boolean; originalBody?: string };

export function PresetEditor({
  step,
  edit,
  onClose,
  onSave,
}: {
  step: PromptStep;
  edit: PresetEdit;
  onClose: () => void;
  onSave: (id: string | undefined, input: PresetInput) => Promise<void>;
}) {
  const [name, setName] = useState(edit.copy ? "" : (edit.row?.name ?? ""));
  const [description, setDescription] = useState(edit.row?.description ?? "");
  const [body, setBody] = useState(edit.originalBody ?? edit.row?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const updating = edit.row && !edit.copy ? edit.row : null;
  const title = edit.copy ? "复制提示词" : updating ? "编辑提示词" : "新建提示词";
  const submit = async () => {
    if (saving || !name.trim() || !body.trim()) return;
    const problem = step === "board" ? checkBoardTemplate(body) : null;
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await onSave(updating?.id, {
        name: name.trim(),
        description: description.trim(),
        body: body.trim(),
        revision: updating?.revision,
      });
    } catch (cause) {
      setError(dramaErrorMessage(cause, "保存失败，请稍后重试"));
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90svh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!saving}
      >
        <DialogHeader>
          <DialogTitle>
            {title} · {promptStepName(step)}
          </DialogTitle>
          <DialogDescription>
            {updating?.status === "enabled"
              ? "保存后，新选择将使用新版；已建项目仍沿用原正文。"
              : updating
                ? "只编辑可替换的正文，不改变生成协议。"
                : "新模板保存为停用状态，启用后创作者才可选择。"}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="grid gap-1.5">
            模板名称
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              autoComplete="off"
              disabled={saving}
            />
          </label>
          <label className="grid gap-1.5">
            用途说明
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={240}
              disabled={saving}
            />
          </label>
          <label className="grid gap-1.5">
            提示词正文
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={PROMPT_BODY_MAX}
              required
              disabled={saving}
              spellCheck={false}
              className="min-h-52 resize-y font-mono text-sm"
            />
          </label>
          {step === "board" && (
            <p className="text-muted-foreground text-xs">
              必须保留 {"{{画面}}"}；可用 {"{{格数}}、{{列数}}、{{行数}}、{{比例}}"}。
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={saving || !name.trim() || !body.trim()}>
              {saving && <Loader2 className="animate-spin" />}保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
