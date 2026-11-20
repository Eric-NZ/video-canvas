import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { gridColumns, type GridColumnSpec } from "@/utils/assets/grid-columns";

/** 首屏（含服务端渲染 / 测试）还没量过窗口时按这个尺寸出行，挂载后由真实尺寸接管 */
const INITIAL_RECT = { width: 1024, height: 800 };

/**
 * 跟随整页（window）滚动的虚拟网格：只挂载视口附近的几行，其余用占位撑高。
 * 一行放几张按容器宽度算（和 CSS 的 auto-fill 同一个规则），每行的实际高度由渲染出来的行量取。
 * @param items 全部条目
 * @param getKey 条目的稳定 key
 * @param renderItem 渲染一个条目
 * @param columns 列规格
 * @param estimateRowHeight 按单元格宽度估一行的高度（含行距），挂载后会被量到的真实高度取代
 */
export function VirtualGrid<T>({
  items,
  getKey,
  renderItem,
  columns,
  estimateRowHeight,
  className,
  ...rest
}: {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  columns: GridColumnSpec;
  estimateRowHeight: (cellWidth: number) => number;
  className?: string;
  "data-slot"?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // 容器顶边到文档顶部的距离：窗口滚动量要减去它才是列表内的滚动量
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      setWidth(el.clientWidth);
      setMargin(el.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cols = gridColumns(width, columns);
  const cellWidth = width > 0 ? (width - columns.gap * (cols - 1)) / cols : columns.minCell;
  const rows = Math.ceil(items.length / cols);

  // useWindowVirtualizer 的返回值不能被 React Compiler 记忆化；只在本组件内使用
  // oxlint-disable-next-line react/incompatible-library
  const virtual = useWindowVirtualizer({
    count: rows,
    estimateSize: () => estimateRowHeight(cellWidth),
    overscan: 3,
    scrollMargin: margin,
    initialRect: INITIAL_RECT,
  });

  return (
    <div
      ref={root}
      className={cn("relative w-full", className)}
      style={{ height: virtual.getTotalSize() }}
      {...rest}
    >
      {virtual.getVirtualItems().map((row) => (
        <div
          key={row.index}
          ref={virtual.measureElement}
          data-index={row.index}
          className="absolute top-0 left-0 grid w-full"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            columnGap: columns.gap,
            // 行距放在行内（下内边距）：量到的行高就已含行距，估算与实际不会错位
            paddingBottom: columns.gap,
            transform: `translateY(${row.start - virtual.options.scrollMargin}px)`,
          }}
        >
          {items.slice(row.index * cols, row.index * cols + cols).map((item) => (
            <div key={getKey(item)} className="min-w-0">
              {renderItem(item)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
