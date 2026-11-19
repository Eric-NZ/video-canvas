import type { ReactNode } from "react";

/** 测试用的「列表 | 画布」切换：只保留行为（高亮、忙时转圈禁用、点击回调），不拉资产管理那一整块 */
export function ViewToggleStub({
  view,
  onChange,
  busy = false,
  busyIcon,
}: {
  view: "list" | "canvas";
  onChange: (view: "list" | "canvas") => void;
  busy?: boolean;
  busyIcon?: ReactNode;
}) {
  return (
    <div role="group">
      {(
        [
          ["list", "列表"],
          ["canvas", "画布"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={view === key}
          disabled={busy && key === "canvas"}
          onClick={() => onChange(key)}
        >
          {busy && key === "canvas" ? busyIcon : null}
          {label}
        </button>
      ))}
    </div>
  );
}
