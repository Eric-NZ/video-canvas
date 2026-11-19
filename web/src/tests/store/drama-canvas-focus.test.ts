import { beforeEach, describe, expect, test } from "bun:test";

import { useCanvasFocusStore } from "@/store/drama-canvas-focus";

/** 片场的「进入画布查看」：先记下要看哪个节点，资产区挂载好画布后取走并定位 */

beforeEach(() => useCanvasFocusStore.setState({ byDrama: {} }));

describe("画布定位请求（按短剧）", () => {
  test("没有请求：取出来是 null", () => {
    expect(useCanvasFocusStore.getState().take("d1")).toBeNull();
  });

  test("记下节点 id，取一次就清掉（刷新页面后不会再跳）；不同短剧互不影响", () => {
    const { request, take } = useCanvasFocusStore.getState();
    request("d1", "b1");
    request("d2", "b2");
    expect(take("d1")).toBe("b1");
    expect(take("d1")).toBeNull();
    expect(take("d2")).toBe("b2");
  });

  test("再次请求覆盖上一次", () => {
    const { request, take } = useCanvasFocusStore.getState();
    request("d1", "b1");
    request("d1", "b9");
    expect(take("d1")).toBe("b9");
  });
});
