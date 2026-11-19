/** 测试用的「列表 | 画布」切换：只保留行为（高亮、点击回调），不拉资产管理那一整块 */
export function ViewToggleStub({
  view,
  onChange,
  listLabel = "列表",
}: {
  view: "list" | "canvas";
  onChange: (view: "list" | "canvas") => void;
  listLabel?: string;
}) {
  return (
    <div role="group">
      {(
        [
          ["list", listLabel],
          ["canvas", "画布"],
        ] as const
      ).map(([key, label]) => (
        <button key={key} type="button" aria-pressed={view === key} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}
