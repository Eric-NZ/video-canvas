import { useState } from "react";

import type { DramaPresetKind } from "@/api/admin/drama-preset/type";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@/components/admin-ui/page-header";
import { Segmented, SegmentedItem } from "@/components/admin-ui/segmented";
import { KIND_LABEL } from "@/utils/admin/drama-preset";
import { canManageInfra } from "@/utils/admin/role";
import { useAdminStore } from "@/store/admin";

import { PresetPanel } from "./preset-panel";

/** 两个种类：题材只有名称，画风另有描述与预览图 */
const KINDS: DramaPresetKind[] = ["genre", "style"];

/**
 * 短剧预设（/admin/drama-presets，设计稿 docs/design/短剧预设后台/短剧预设后台.md §6）。
 *
 * 这里维护的清单就是开拍设置里能选到的全部内容：改完立刻生效（后端写操作会让目录缓存失效），
 * 不需要发版。题材与画风共用同一张表，所以做成两个 Tab 而不是两个页面。
 * 删除只有 super_admin 能做；被短剧引用的条目后端会拒，只能停用。请求错误由拦截器统一提示。
 */
export default function DramaPresetsPage() {
  const role = useAdminStore((state) => state.role);
  const [kind, setKind] = useState<DramaPresetKind>("style");

  return (
    <div className="h-full overflow-y-auto">
      <main className="px-4 py-6 lg:px-6">
        <PageHeader>
          <PageHeaderHeading>
            <PageHeaderTitle>短剧预设</PageHeaderTitle>
          </PageHeaderHeading>
          <PageHeaderActions>
            <Segmented aria-label="预设种类">
              {KINDS.map((item) => (
                <SegmentedItem
                  key={item}
                  active={kind === item}
                  slideId="drama-preset-kind"
                  onClick={() => setKind(item)}
                >
                  {KIND_LABEL[item]}
                </SegmentedItem>
              ))}
            </Segmented>
          </PageHeaderActions>
        </PageHeader>

        {/* key={kind}：换种类就整块重挂载，列表与加载状态自动回到初始值 */}
        <PresetPanel key={kind} kind={kind} canDelete={canManageInfra(role)} />
      </main>
    </div>
  );
}
