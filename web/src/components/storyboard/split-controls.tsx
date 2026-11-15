import { Loader2, Sparkles } from "lucide-react";

import { ChromeButton, ChromeSeparator } from "@/components/canvas/chrome/chrome";
import { AgentModelPicker } from "@/components/drama/agent-model-picker";
import { useStoryboardSplitUi } from "@/hooks/use-storyboard-split";
import { cn } from "@/lib/utils";
import { useStoryboardSplit } from "@/store/storyboard-split";

/**
 * 「模型 + 从剧本拆分镜」：弹窗标题栏和节点功能区共用（设计 §6.1），放在清透胶囊里。
 * 模型下拉复用短剧的 Agent 模型下拉；两处选的是同一份。没连剧本 / 剧本没内容时按钮禁用，悬停说明原因。
 * @param id 分镜表节点 id
 * @param compact 为 true 时按钮只留图标（文字给读屏用）
 * @param withModel 为 false 时不摆模型下拉（节点功能栏里不选模型，用弹窗标题栏里选好、记在本机的那个）
 */
export function SplitControls({
  id,
  compact,
  withModel = true,
}: {
  id: string;
  compact?: boolean;
  withModel?: boolean;
}) {
  const model = useStoryboardSplit((s) => s.model);
  const setModel = useStoryboardSplit((s) => s.setModel);
  const { reason, busy, trigger } = useStoryboardSplitUi(id);

  return (
    <>
      {withModel && (
        <>
          <AgentModelPicker
            value={model}
            variant="chrome"
            onChange={setModel}
            disabledReason={busy ? () => "正在拆分镜" : undefined}
          />
          <ChromeSeparator />
        </>
      )}
      {/* 禁用的按钮不收鼠标事件，悬停提示挂在外面一层 */}
      <span title={reason || undefined} className="inline-flex">
        <ChromeButton
          onClick={trigger}
          disabled={!!reason}
          aria-busy={busy || undefined}
          aria-label={busy ? "拆分中" : "从剧本拆分镜"}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
          <span className={cn("text-foreground text-sm", compact && "sr-only")}>
            {busy ? "拆分中" : compact ? "拆分镜" : "从剧本拆分镜"}
          </span>
        </ChromeButton>
      </span>
    </>
  );
}
