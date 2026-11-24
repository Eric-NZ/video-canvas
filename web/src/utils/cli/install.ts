import { toast } from "sonner";

import { copyToClipboard } from "@/utils/admin/clipboard";
import { cliApiBase } from "@/utils/cli/api-base";

/** CLI 的包名（npm 全局安装后用它卸载）；不发布到 npm 仓库，只经 GitHub Release 分发 */
export const CLI_NPM_PACKAGE = "video-canvas-cli";

/** 最新安装包：每次发版挂在 GitHub Release 上，文件名固定，latest 永远指向最新一版 */
export const CLI_PACKAGE_URL =
  "https://github.com/zaylora/video-canvas/releases/latest/download/video-canvas-cli.tgz";

/** 手动安装 / 升级命令：一键脚本之外的备选（脚本会额外校验 sha256 并装好技能） */
export const CLI_INSTALL_COMMAND = `npm i -g ${CLI_PACKAGE_URL}`;

/** 各平台的一键安装命令 */
export interface CLIInstallCommands {
  unix: string;
  powershell: string;
  cmd: string;
}

/**
 * 一键安装命令：脚本放在网页的静态目录（public/cli/），由网页所在的站点下发，
 * 所以用页面的 origin 拼，不用接口地址。脚本会装 CLI 并把技能装进终端助手。
 * @param site 网页站点根，例如 https://example.com
 */
export function cliInstallCommands(site: string): CLIInstallCommands {
  const root = site.replace(/\/+$/, "");
  const ps1 = `irm ${root}/cli/install.ps1 | iex`;
  return {
    unix: `curl -fsSL ${root}/cli/install.sh | sh`,
    powershell: ps1,
    // CMD 里没有 irm：转给 PowerShell 跑，并临时放开执行策略（只对这一次进程生效）
    cmd: `powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps1}"`,
  };
}

/** 拼提示要的两个地址：网页站点根（下脚本）与接口根（登录用） */
export interface CLISiteInfo {
  site: string;
  apiBase: string;
}

/**
 * 生成「交给 Agent」的整段提示：用户把它粘进 Claude Code、Codex 这类终端助手，
 * 由助手按系统挑一条命令装好 CLI 与技能，再带着用户走完登录授权。
 */
export function buildCLIAgentPrompt({ site, apiBase }: CLISiteInfo): string {
  const cmds = cliInstallCommands(site);
  return `请帮我安装连镜（video-canvas）CLI 与配套 Skill，根据当前系统执行对应命令（需要 Node.js 22.18 及以上）：

macOS / Linux: ${cmds.unix}
Windows PowerShell: ${cmds.powershell}
Windows CMD: ${cmds.cmd}

登录本站时使用：vc login --base ${apiBase}

安装后请阅读 Skill，引导我完成可用性验证、登录和授权。`;
}

/** 当前页面对应的站点与接口地址（接口地址与应用实际请求一致，见 api-base.ts） */
export function currentCLISite(): CLISiteInfo {
  return {
    site: typeof window === "undefined" ? "" : window.location.origin,
    apiBase: cliApiBase(import.meta.env.VITE_API_BASE_URL),
  };
}

/** 复制与提示的依赖，默认用浏览器剪贴板和全局 toast；测试里传假的 */
export interface CopyCLIDeps {
  copy: (text: string) => Promise<boolean>;
  success: (message: string) => void;
  failure: (message: string) => void;
}

const defaultDeps: CopyCLIDeps = {
  copy: (text) => copyToClipboard(text),
  success: (message) => void toast.success(message),
  failure: (message) => void toast.error(message),
};

/**
 * 复制给 Agent 的安装提示并给出反馈。
 * 复制失败（非 https 且没有兜底）时指向 /cli 页，那里可以手动选中。
 * @returns 是否复制成功
 */
export async function copyCLIAgentPrompt(
  info: CLISiteInfo = currentCLISite(),
  deps: CopyCLIDeps = defaultDeps,
): Promise<boolean> {
  const ok = await deps.copy(buildCLIAgentPrompt(info));
  if (ok) deps.success("已复制，粘贴给你的 Agent 即可");
  else deps.failure("复制失败，请到「命令行（CLI）」页手动复制");
  return ok;
}
