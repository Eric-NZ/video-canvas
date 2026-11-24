import { useEffect, useRef, useState, type ComponentType } from "react";
import ClaudeCode from "@lobehub/icons/es/ClaudeCode/components/Color";
import CodeBuddy from "@lobehub/icons/es/CodeBuddy/components/Color";
import Codex from "@lobehub/icons/es/Codex/components/Color";
import Cursor from "@lobehub/icons/es/Cursor/components/Mono";
import GeminiCLI from "@lobehub/icons/es/GeminiCLI/components/Color";
import Kimi from "@lobehub/icons/es/Kimi/components/Color";
import Trae from "@lobehub/icons/es/Trae/components/Color";
import { ArrowUpRight, Check, SquareTerminal } from "lucide-react";
import { Link } from "react-router";

import { DialogSession } from "@/components/dialog-session";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { copyCLIAgentPrompt } from "@/utils/cli/install";

/** 顶部那排终端 Agent：都能跑 vc 并读随包技能。center 是中间放大的那一个 */
export const CLI_AGENTS: Array<{
  name: string;
  Icon: ComponentType<{ size?: number | string }>;
  center?: boolean;
}> = [
  { name: "Kimi", Icon: Kimi },
  { name: "Cursor", Icon: Cursor },
  { name: "Codex", Icon: Codex },
  { name: "Claude Code", Icon: ClaudeCode, center: true },
  { name: "Gemini CLI", Icon: GeminiCLI },
  { name: "Trae", Icon: Trae },
  { name: "CodeBuddy", Icon: CodeBuddy },
];

/**
 * 卡片里的能力清单，分两组。只写 CLI 现在真能做的（对照 cli/src/cli.ts 的帮助）：
 * 成片合成等后端还没有的能力不写，改 CLI 能力时这里一起改。
 */
export const CLI_FEATURE_GROUPS: string[][] = [
  [
    "图片、视频、音频与文本生成，等到出结果",
    "画布读写与节点编辑，带版本保护",
    "复杂操作交给画布 Agent",
  ],
  [
    "批量提交与任务核对，查积分余额",
    "结构化输出，脚本与 Agent 直接解析",
    "浏览器确认一次即可登录，不交出密码",
  ],
];

/**
 * 「在 Agent 里使用」弹窗：一张画布 CLI 卡片，复制给 Agent 的整段安装提示（见 utils/cli/install.ts）。
 * 常驻挂载，用 open 开关，正文由 DialogSession 包住（coding-standards 6.3）。
 * @param copy 复制动作，默认复制本站的安装提示并弹 toast；测试里传假的
 */
export function CLIAgentDialog({
  open,
  onOpenChange,
  copy = () => copyCLIAgentPrompt(),
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copy?: () => Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-chrome ring-chrome-border flex max-h-[min(88svh,720px)] flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 [corner-shape:squircle] sm:max-w-lg">
        <DialogSession open={open}>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-8 pb-6">
            <AgentStack />
            <DialogTitle className="mt-6 text-center text-2xl font-semibold tracking-tight">
              在你的 Agent 里用连镜创作
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-2 text-center text-sm">
              支持日常创作、批量生产，适用主流终端 Agent
            </DialogDescription>
            <CLICard copy={copy} onNavigate={() => onOpenChange(false)} />
          </div>
        </DialogSession>
      </DialogContent>
    </Dialog>
  );
}

/** 一排略微重叠的 Agent 图标，中间那个放大、压在最上层 */
function AgentStack() {
  return (
    <div className="flex items-center justify-center">
      {CLI_AGENTS.map(({ name, Icon, center }, i) => (
        <span
          key={name}
          role="img"
          aria-label={name}
          title={name}
          className={cn(
            "bg-chrome ring-chrome-border text-foreground grid shrink-0 place-items-center rounded-xl shadow-lg ring-1 backdrop-blur-xl [corner-shape:squircle]",
            i > 0 && "-ml-2",
            center ? "z-10 size-16 rounded-2xl" : "size-12",
          )}
        >
          <Icon size={center ? 36 : 26} />
        </span>
      ))}
    </div>
  );
}

/** 画布 CLI 卡片：标题 + 复制按钮、一句定位、两组能力清单、详细指南 */
function CLICard({ copy, onNavigate }: { copy: () => Promise<boolean>; onNavigate: () => void }) {
  return (
    <section className="ring-chrome-border mt-8 grid gap-4 rounded-xl p-4 ring-1 [corner-shape:squircle]">
      <header className="flex items-center gap-3">
        <span className="bg-chrome-hover ring-chrome-border grid size-10 shrink-0 place-items-center rounded-lg ring-1 [corner-shape:squircle]">
          <SquareTerminal className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">画布 CLI</h3>
          <p className="text-muted-foreground text-xs">在终端里读写画布、批量生成</p>
        </div>
        <CopyForAgentButton copy={copy} />
      </header>
      {CLI_FEATURE_GROUPS.map((group) => (
        <ul
          key={group[0]}
          className="bg-chrome-hover grid gap-2.5 rounded-lg px-4 py-3 [corner-shape:squircle]"
        >
          {group.map((item) => (
            <li key={item} className="flex items-center gap-2.5 text-sm">
              <Check className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      ))}
      <Link
        to="/cli/docs"
        onClick={onNavigate}
        className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 text-sm transition-colors"
      >
        详细指南
        <ArrowUpRight className="size-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

/** 主操作：实心胶囊，复制成功后短暂显示「已复制」；失败的原因由 copy 自己的 toast 给出 */
function CopyForAgentButton({ copy }: { copy: () => Promise<boolean> }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const onClick = async () => {
    if (!(await copy())) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className="bg-foreground text-background inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium shadow-sm transition-opacity hover:opacity-90"
    >
      {copied && <Check className="size-4" aria-hidden="true" />}
      {copied ? "已复制" : "复制命令给 Agent"}
    </button>
  );
}
