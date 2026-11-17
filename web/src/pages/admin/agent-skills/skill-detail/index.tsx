import { Download, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import type { SkillFile, SkillFileContent, SkillVersionView } from "@/api/admin/agent-skill/type.d";
import { getSkillFile } from "@/api/admin/agent-skill";
import { DataPage } from "@/components/admin-ui/data-panel";
import { EmptyState, EmptyStateTitle } from "@/components/admin-ui/empty-state";
import { GLASS_PANEL } from "@/components/admin-ui/glass";
import { Segmented, SegmentedItem } from "@/components/admin-ui/segmented";
import { UnderlineTab, UnderlineTabs } from "@/components/admin-ui/underline-tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { FileWorkbench } from "../file-workbench";
import { VersionTimeline } from "../version-timeline";
import { DetailHeader } from "./detail-header";
import { InfoCard } from "./info-card";
import { ScopeCard } from "./scope-card";
import { useSkillDetail, type SkillDetailApi } from "./use-skill-detail";

/** 技能列表页的地址 */
const LIST_PATH = "/admin/agent/skills";

/** 内置技能没有包：用详情里的正文拼成只有一个 SKILL.md 的清单，复用文件工作台 */
function builtinFiles(body: string): SkillFile[] {
  return [
    { path: "SKILL.md", size: new TextEncoder().encode(body).length, kind: "skill", text: true },
  ];
}

/**
 * 技能详情页 /admin/agent/skills/:name。按技能名重挂，换技能时不残留上一个的状态。
 */
export default function SkillDetailPage() {
  const { name = "" } = useParams();
  return <SkillDetail key={name} name={name} />;
}

/**
 * 页头 + 待生效横幅 + 左「文件 / 版本」+ 右「用在哪里 / 信息」；窄于 lg 时右栏移到页签上方。
 * 当前页签和“文件”里查看的版本记在地址的 ?tab= 与 ?v=，刷新不丢。
 */
function SkillDetail({ name }: { name: string }) {
  const navigate = useNavigate();
  // 从列表点进来时后退能带回列表的搜索、筛选和页码；直接打开的链接没有历史可退，回到列表首页
  const back = useCallback(() => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate(LIST_PATH);
  }, [navigate]);
  const api = useSkillDetail(name, () => navigate(LIST_PATH, { replace: true }));
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "versions" ? "versions" : "files";
  const viewVersion = Number(params.get("v")) || null;

  const setQuery = (next: { tab?: string; v?: number | null }) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next.tab !== undefined) {
          if (next.tab === "files") out.delete("tab");
          else out.set("tab", next.tab);
        }
        if (next.v !== undefined) {
          if (next.v == null) out.delete("v");
          else out.set("v", String(next.v));
        }
        return out;
      },
      { replace: true },
    );

  if (api.status === "missing" || api.status === "error") {
    return (
      <DataPage>
        <EmptyState className="m-auto">
          <EmptyStateTitle className={cn(api.status === "error" && "text-destructive")}>
            {api.status === "missing" ? "技能不存在或已删除" : "技能加载失败"}
          </EmptyStateTitle>
          {api.status === "missing" ? (
            <Button variant="outline" size="sm" onClick={() => navigate(LIST_PATH)}>
              返回技能列表
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void api.reload()}>
              重试
            </Button>
          )}
        </EmptyState>
      </DataPage>
    );
  }

  const item = api.detail;
  if (!item) {
    return (
      <DataPage className="gap-4" aria-busy="true">
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-12 w-80 rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Skeleton className="h-96 rounded-3xl" />
          <Skeleton className="h-72 rounded-3xl" />
        </div>
      </DataPage>
    );
  }

  const filesVersion = viewVersion ?? item.active_version ?? item.versions[0]?.version ?? null;
  const pending = item.pending_version && item.active_version != null;

  return (
    <DataPage className="gap-4">
      <DetailHeader
        item={item}
        onBack={back}
        onRenamed={api.replaceItem}
        onDownload={() => item.active_version != null && void api.download(item.active_version)}
        onDelete={() => void api.removeSkill()}
      />

      {pending && (
        <div
          data-slot="pending-banner"
          className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-500/10 px-4 py-2.5 text-sm ring-1 ring-amber-500/25"
        >
          <Sparkles className="size-4 text-amber-600 dark:text-amber-400" />
          <span>
            <span className="font-mono font-medium">v{item.latest_version}</span> 已导入，尚未生效
          </span>
          <span className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setQuery({ tab: "files", v: item.latest_version })}
            >
              对比文件
            </Button>
            <Button
              size="sm"
              disabled={api.busyVersion != null}
              onClick={() => void api.activateVersion(item.latest_version)}
            >
              设为生效
            </Button>
          </span>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <aside className="grid gap-4 lg:order-last">
          <ScopeCard
            item={item}
            busy={api.busy}
            onToggle={(scope, next) => api.toggleScope(scope, next)}
          />
          <InfoCard item={item} />
        </aside>

        <section
          className={cn(GLASS_PANEL, "flex min-h-[560px] min-w-0 flex-col overflow-hidden")}
          aria-label="技能内容"
        >
          <UnderlineTabs className="border-chrome-border shrink-0">
            <UnderlineTab selected={tab === "files"} onClick={() => setQuery({ tab: "files" })}>
              文件
            </UnderlineTab>
            <UnderlineTab
              selected={tab === "versions"}
              onClick={() => setQuery({ tab: "versions" })}
            >
              版本
              {item.versions.length > 0 && (
                <span className="text-muted-foreground tabular-nums">{item.versions.length}</span>
              )}
            </UnderlineTab>
          </UnderlineTabs>

          {tab === "files" ? (
            <FilesTab
              key={filesVersion ?? "none"}
              api={api}
              version={filesVersion}
              onPickVersion={(v) => setQuery({ v })}
            />
          ) : item.readonly ? (
            <EmptyState className="flex-1">
              <EmptyStateTitle>内置技能没有版本历史</EmptyStateTitle>
            </EmptyState>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <VersionTimeline
                versions={item.versions}
                activeVersion={item.active_version}
                busyVersion={api.busyVersion}
                actions={{
                  onActivate: (head) => void api.activateVersion(head.version),
                  onViewFiles: (head) => setQuery({ tab: "files", v: head.version }),
                  onDownload: (head) => void api.download(head.version),
                  onDelete: api.removeVersion,
                }}
              />
            </div>
          )}
        </section>
      </div>
    </DataPage>
  );
}

/**
 * “文件”页签：导入技能上方是版本切换 + 下载整包，下面是文件工作台；内置技能只有一个 SKILL.md。
 * @param version 查看的版本；没有版本为 null
 */
function FilesTab({
  api,
  version,
  onPickVersion,
}: {
  api: SkillDetailApi;
  version: number | null;
  onPickVersion: (version: number) => void;
}) {
  const item = api.detail!;
  const [view, setView] = useState<SkillVersionView | null>(null);
  const [failed, setFailed] = useState(false);
  const { loadVersion } = api;

  useEffect(() => {
    if (item.readonly || version == null) return;
    let stale = false;
    loadVersion(version).then(
      (next) => !stale && setView(next),
      () => !stale && setFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [item.readonly, version, loadVersion]);

  const readVersionFile = useCallback(
    (path: string): Promise<SkillFileContent> =>
      version == null
        ? Promise.reject(new Error("没有版本"))
        : getSkillFile(item.name, version, path),
    [item.name, version],
  );
  const body = item.body ?? "";
  const builtinList = useMemo(() => builtinFiles(body), [body]);
  const readBuiltinFile = useCallback(
    async (path: string): Promise<SkillFileContent> => ({
      path,
      size: new TextEncoder().encode(body).length,
      binary: false,
      text: body,
    }),
    [body],
  );

  if (item.readonly) {
    return (
      <FileWorkbench
        files={builtinList}
        issues={[]}
        readFile={readBuiltinFile}
        frontmatter={{ name: item.name, description: item.description }}
        unsupported={[]}
      />
    );
  }

  return (
    <>
      <div className="border-chrome-border flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <Segmented aria-label="查看版本">
          {item.versions.map((head) => (
            <SegmentedItem
              key={head.version}
              slideId="files-version"
              active={head.version === version}
              className="px-2.5 py-1 font-mono tabular-nums"
              onClick={() => onPickVersion(head.version)}
            >
              v{head.version}
            </SegmentedItem>
          ))}
        </Segmented>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={version == null}
          onClick={() => version != null && void api.download(version)}
        >
          <Download />
          下载整包
        </Button>
      </div>
      {failed ? (
        <EmptyState className="flex-1">
          <EmptyStateTitle className="text-destructive">文件清单加载失败</EmptyStateTitle>
        </EmptyState>
      ) : view ? (
        <FileWorkbench
          files={view.files}
          issues={view.issues}
          readFile={readVersionFile}
          frontmatter={view.frontmatter}
          unsupported={view.unsupported_fields}
        />
      ) : (
        <div className="p-4" aria-busy="true">
          <Skeleton className="h-40 rounded-xl" />
        </div>
      )}
    </>
  );
}
