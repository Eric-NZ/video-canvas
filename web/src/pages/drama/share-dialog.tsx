import { useEffect, useState } from "react";
import { toast } from "sonner";
import { dramaSharing, type SharingMode, type Viewer } from "@/api/drama/share";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const modes = [
  {
    mode: "view",
    label: "仅可查看",
    detail: "对方从「共享给我」进入完整工作台，查看最新资产和分集。你可以随时收回权限。",
    action: "授予查看权限",
  },
  {
    mode: "copy",
    label: "发送副本",
    detail: "对方在「我的短剧」收到可继续创作的完整副本，双方各自编辑。",
    action: "发送副本",
  },
  {
    mode: "transfer",
    label: "转移所有权",
    detail: "对方接手创作，你的账号将移除这部短剧。",
    action: "核对转移信息",
  },
] as const;

export function DramaShareDialog({
  id,
  title,
  close,
  transferred,
}: {
  id: string;
  title: string;
  close: () => void;
  transferred: () => void;
}) {
  const [mode, setMode] = useState<SharingMode>("view");
  const [email, setEmail] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<Viewer[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [key, setKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let active = true;
    setFailed(false);
    void dramaSharing.members(id).then(
      (items) => {
        if (active) setMembers(items);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [id, reload]);
  const submit = async () => {
    if (mode === "transfer" && !confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    try {
      await dramaSharing.submit(id, mode, email.trim(), key);
      toast.success(
        mode === "view" ? "已授予查看权限" : mode === "copy" ? "已发送副本" : "已转移所有权",
      );
      if (mode === "transfer") transferred();
      close();
    } catch {
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (member: string) => {
    setBusy(true);
    try {
      await dramaSharing.remove(id, member);
      setMembers((items) => items?.filter((item) => item.id !== member) ?? null);
      toast.success("已收回查看权限");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{confirm ? "确认转移所有权" : `共享《${title}》`}</DialogTitle>
          <DialogDescription>
            {confirm
              ? `将《${title}》转移给 ${email.trim()}。你的账号将移除该剧，现有 ${members?.length ?? 0} 位查看者的权限将被收回。`
              : "用接收方的注册邮箱共享这部短剧。"}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy || confirm} hidden={confirm} className="grid gap-4">
            <label className="grid gap-2 text-sm">
              接收方邮箱
              <Input
                type="email"
                required
                maxLength={128}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setKey(crypto.randomUUID());
                }}
              />
            </label>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm">共享方式</legend>
              {modes.map((option) => (
                <label
                  key={option.mode}
                  className="border-border flex cursor-pointer items-start gap-3 rounded-lg border p-3"
                >
                  <input
                    type="radio"
                    name="mode"
                    className="mt-1"
                    checked={mode === option.mode}
                    onChange={() => {
                      setMode(option.mode);
                      setKey(crypto.randomUUID());
                    }}
                  />
                  <span className="text-sm font-medium">
                    {option.label}
                    <span className="text-muted-foreground mt-1 block text-xs font-normal">
                      {option.detail}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => (confirm ? setConfirm(false) : close())}
            >
              {confirm ? "返回核对" : "取消"}
            </Button>
            <Button
              type="submit"
              variant={confirm ? "destructive" : "default"}
              disabled={busy || (mode === "transfer" && !members)}
            >
              {busy
                ? "处理中…"
                : confirm
                  ? "确认转移"
                  : modes.find((item) => item.mode === mode)?.action}
            </Button>
          </div>
        </form>
        {!confirm && (
          <section className="border-border grid gap-1 border-t pt-3">
            <h3 className="text-sm font-medium">可查看此剧的人</h3>
            {failed ? (
              <Button variant="ghost" onClick={() => setReload((value) => value + 1)}>
                重新加载成员
              </Button>
            ) : !members ? (
              <p>加载中…</p>
            ) : members.length === 0 ? (
              <p className="text-muted-foreground text-sm">暂无查看成员</p>
            ) : (
              members.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm">{item.email}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void remove(item.id).catch(() => undefined)}
                  >
                    移除
                  </Button>
                </div>
              ))
            )}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
