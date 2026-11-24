import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 一键安装脚本（web/public/cli/install.sh）的行为测试：
 * 用假的 node / npm / curl / vc 顶替真实命令，只看脚本按什么顺序调了什么。
 */
const SCRIPT = path.resolve(import.meta.dir, "../../../public/cli/install.sh");
const PS1 = path.resolve(import.meta.dir, "../../../public/cli/install.ps1");
const LATEST = "https://github.com/zaylora/video-canvas/releases/latest/download";

/** 假安装包的内容与它真实的 sha256 */
const PACKAGE_BODY = "fake video-canvas-cli package";
const PACKAGE_SHA = createHash("sha256").update(PACKAGE_BODY).digest("hex");

interface Fake {
  bin: string;
  log: string;
  home: string;
}

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode: 0o755 });
}

/**
 * 造一套假命令。
 * nodeVersion 决定版本检查；npmGlobalFails 模拟全局目录没写权限；badChecksum 模拟包被篡改或下载不完整。
 */
function fakeEnv(
  opts: { nodeVersion?: string; npmGlobalFails?: boolean; badChecksum?: boolean } = {},
): Fake {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vc-install-"));
  const bin = path.join(root, "bin");
  const log = path.join(root, "calls.log");
  const home = path.join(root, "home");
  const globalPrefix = path.join(root, "global");
  fs.mkdirSync(home);
  const version = opts.nodeVersion ?? "22.18.0";
  const [major, minor] = version.split(".").map(Number);
  const ok = (major ?? 0) > 22 || (major === 22 && (minor ?? 0) >= 18);
  write(
    path.join(bin, "node"),
    `#!/bin/sh\nif [ "$1" = "-v" ]; then echo v${version}; exit 0; fi\nexit ${ok ? 0 : 1}\n`,
  );
  write(
    path.join(root, "vc-template"),
    `#!/bin/sh\necho "vc $*" >> "${log}"\necho "video-canvas-cli 1.0.0"\n`,
  );
  const sha = opts.badChecksum ? "0".repeat(64) : PACKAGE_SHA;
  // curl -fsSL <url> -o <file>：按地址后缀写包或校验文件
  write(
    path.join(bin, "curl"),
    `#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; -*) ;; *) url="$1" ;; esac
  shift
done
echo "curl $url" >> "${log}"
case "$url" in
  *missing*) exit 22 ;;
  *.tgz.sha256) printf '%s  video-canvas-cli.tgz\\n' "${sha}" > "$out" ;;
  *.tgz) printf '%s' "${PACKAGE_BODY}" > "$out" ;;
  *) exit 22 ;;
esac
`,
  );
  write(
    path.join(bin, "npm"),
    `#!/bin/sh
echo "npm $*" >> "${log}"
case "$*" in
  "prefix -g") echo "${globalPrefix}" ;;
  *"--prefix"*) mkdir -p "$HOME/.local/bin" && cp "${root}/vc-template" "$HOME/.local/bin/vc" ;;
  "install -g"*) ${opts.npmGlobalFails ? 'echo "EACCES: permission denied" >&2; exit 243' : `mkdir -p "${globalPrefix}/bin" && cp "${root}/vc-template" "${globalPrefix}/bin/vc"`} ;;
esac
`,
  );
  return { bin, log, home };
}

function run(fake: Fake, env: Record<string, string> = {}) {
  const res = spawnSync("sh", [SCRIPT], {
    env: { PATH: `${fake.bin}:/usr/bin:/bin`, HOME: fake.home, ...env },
    encoding: "utf8",
  });
  const calls = fs.existsSync(fake.log) ? fs.readFileSync(fake.log, "utf8").trim().split("\n") : [];
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, calls };
}

const npmInstall = (calls: string[]) => calls.filter((c) => c.startsWith("npm install"));

describe("一键安装脚本 install.sh", () => {
  test("从 GitHub 最新 Release 下载安装包和校验文件，校验通过后用 npm 装本地包，再装技能", () => {
    const res = run(fakeEnv());
    expect(res.code).toBe(0);
    expect(res.calls).toContain(`curl ${LATEST}/video-canvas-cli.tgz`);
    expect(res.calls).toContain(`curl ${LATEST}/video-canvas-cli.tgz.sha256`);
    const installs = npmInstall(res.calls);
    expect(installs).toHaveLength(1);
    expect(installs[0]).toMatch(/^npm install -g \/.+\/video-canvas-cli\.tgz$/);
    expect(res.calls.at(-1)).toBe("vc skill install");
    expect(res.stdout).toContain("vc login");
  });

  // 中文 locale 下变量紧跟全角标点（`$ACTUAL）`）会被 sh 当成变量名的一部分，报 unbound variable，
  // 用户看不到真正的原因；所以在 UTF-8 locale 下也要拿到完整的提示
  for (const lang of ["C", "en_US.UTF-8", "zh_CN.UTF-8"]) {
    test(`校验和对不上时中止，不调用 npm 安装（LANG=${lang}）`, () => {
      const res = run(fakeEnv({ badChecksum: true }), { LANG: lang, LC_ALL: lang });
      expect(res.code).not.toBe(0);
      expect(res.stderr).toContain("安装包校验失败");
      expect(res.stderr).not.toContain("unbound variable");
      expect(npmInstall(res.calls)).toEqual([]);
    });

    test(`下载失败时提示镜像变量（LANG=${lang}）`, () => {
      const res = run(fakeEnv(), {
        LANG: lang,
        LC_ALL: lang,
        VC_DOWNLOAD_BASE: "https://mirror.example.com/missing",
      });
      expect(res.code).not.toBe(0);
      expect(res.stderr).toContain("VC_DOWNLOAD_BASE");
      expect(res.stderr).not.toContain("unbound variable");
    });
  }

  test("VC_CLI_VERSION 指定版本时从对应 tag 的 Release 下载", () => {
    const res = run(fakeEnv(), { VC_CLI_VERSION: "v0.7.3" });
    expect(res.code).toBe(0);
    expect(res.calls).toContain(
      "curl https://github.com/zaylora/video-canvas/releases/download/v0.7.3/video-canvas-cli.tgz",
    );
  });

  test("VC_DOWNLOAD_BASE 可以换成镜像地址（GitHub 访问不畅时用）", () => {
    const res = run(fakeEnv(), { VC_DOWNLOAD_BASE: "https://mirror.example.com/vc/" });
    expect(res.code).toBe(0);
    expect(res.calls).toContain("curl https://mirror.example.com/vc/video-canvas-cli.tgz");
  });

  test("全局目录没权限时退到 ~/.local，并提示把它加进 PATH", () => {
    const res = run(fakeEnv({ npmGlobalFails: true }));
    expect(res.code).toBe(0);
    const installs = npmInstall(res.calls);
    expect(installs.at(-1)).toMatch(
      /^npm install -g --prefix .+\/\.local .+video-canvas-cli\.tgz$/,
    );
    expect(res.calls).toContain("vc skill install");
    expect(res.stdout).toContain(".local/bin");
  });

  test("Node 低于 22.18 时直接报错，什么都不下载", () => {
    const res = run(fakeEnv({ nodeVersion: "20.11.0" }));
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("22.18");
    expect(res.calls).toEqual([]);
  });

  test("两个脚本都是静态内容：只认 GitHub Release，不含站点地址占位，也不再走 npm 仓库", () => {
    for (const file of [SCRIPT, PS1]) {
      const body = fs.readFileSync(file, "utf8");
      expect(body).not.toContain("__BASE__");
      expect(body).toContain("github.com/zaylora/video-canvas/releases");
      expect(body).toContain("video-canvas-cli.tgz");
      expect(body).toContain(".sha256");
      expect(body).toContain("skill install");
      expect(body).not.toContain("@latest");
    }
  });
});
