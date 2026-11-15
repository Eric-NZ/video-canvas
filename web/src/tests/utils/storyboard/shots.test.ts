import { describe, expect, test } from "bun:test";

import type { StoryboardShot } from "@/types";
import {
  addShot,
  clampDuration,
  duplicateShot,
  emptyStoryboard,
  formatDuration,
  insertShot,
  moveShot,
  normalizeStoryboard,
  removeShot,
  shotNumbers,
  totalDuration,
  updateShot,
} from "@/utils/storyboard/shots";

const ids = () => {
  let n = 0;
  return () => `s${++n}`;
};

const shot = (id: string, patch: Partial<StoryboardShot> = {}): StoryboardShot => ({
  id,
  scene: `画面${id}`,
  shot: "",
  camera: "",
  action: "",
  dialogue: "",
  duration: 3,
  ...patch,
});

const board = (...list: StoryboardShot[]) => ({ shots: list });

describe("新建与增删", () => {
  test("新建的分镜表没有镜头", () => {
    expect(emptyStoryboard()).toEqual({ shots: [] });
  });

  test("末尾新增一行，默认时长 3 秒、字段为空", () => {
    const next = addShot(board(shot("a")), ids());
    expect(next.shots.map((s) => s.id)).toEqual(["a", "s1"]);
    expect(next.shots[1]).toEqual({
      id: "s1",
      scene: "",
      shot: "",
      camera: "",
      action: "",
      dialogue: "",
      duration: 3,
    });
  });

  test("在某行上方、下方插入", () => {
    const start = board(shot("a"), shot("b"));
    expect(insertShot(start, "b", "before", ids()).shots.map((s) => s.id)).toEqual([
      "a",
      "s1",
      "b",
    ]);
    expect(insertShot(start, "a", "after", ids()).shots.map((s) => s.id)).toEqual(["a", "s1", "b"]);
  });

  test("插入的参照行不存在时加到末尾", () => {
    expect(insertShot(board(shot("a")), "x", "before", ids()).shots.map((s) => s.id)).toEqual([
      "a",
      "s1",
    ]);
  });

  test("复制一行：内容相同、换新 id、紧跟在原行后面", () => {
    const next = duplicateShot(
      board(shot("a", { shot: "特写", duration: 4.5 }), shot("b")),
      "a",
      ids(),
    );
    expect(next.shots.map((s) => s.id)).toEqual(["a", "s1", "b"]);
    expect(next.shots[1]).toEqual({ ...shot("a", { shot: "特写", duration: 4.5 }), id: "s1" });
  });

  test("删除一行，找不到时原样返回", () => {
    const start = board(shot("a"), shot("b"));
    expect(removeShot(start, "a").shots.map((s) => s.id)).toEqual(["b"]);
    expect(removeShot(start, "x")).toBe(start);
  });

  test("改一行的字段，时长越界时修正到边界", () => {
    const start = board(shot("a"), shot("b"));
    const next = updateShot(start, "b", { camera: "推", duration: 99 });
    expect(next.shots[1]).toMatchObject({ camera: "推", duration: 60 });
    expect(next.shots[0]).toBe(start.shots[0]);
  });
});

describe("拖拽排序与镜号", () => {
  test("把第 1 行拖到第 3 行的位置", () => {
    const next = moveShot(board(shot("a"), shot("b"), shot("c")), "a", 2);
    expect(next.shots.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  test("目标位置越界时夹到两端", () => {
    const start = board(shot("a"), shot("b"), shot("c"));
    expect(moveShot(start, "c", -5).shots.map((s) => s.id)).toEqual(["c", "a", "b"]);
    expect(moveShot(start, "a", 99).shots.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  test("镜号按行序从 1 连续编号，增删排序后重排", () => {
    let next = board(shot("a"), shot("b"), shot("c"));
    next = removeShot(next, "b");
    next = addShot(next, ids());
    next = moveShot(next, "s1", 0);
    expect(shotNumbers(next)).toEqual({ s1: 1, a: 2, c: 3 });
  });
});

describe("时长", () => {
  test("时长限制在 1–60 秒、保留 1 位小数，非数字取默认值", () => {
    expect(clampDuration(0)).toBe(1);
    expect(clampDuration(61)).toBe(60);
    expect(clampDuration(2.46)).toBe(2.5);
    expect(clampDuration(Number.NaN)).toBe(3);
    expect(clampDuration("5" as unknown)).toBe(3);
  });

  test("总时长实时累加，没有浮点误差", () => {
    expect(
      totalDuration(board(shot("a", { duration: 0.1 * 3 }), shot("b", { duration: 2.7 }))),
    ).toBe(3);
    expect(totalDuration(board(shot("a", { duration: 1.1 }), shot("b", { duration: 2.2 })))).toBe(
      3.3,
    );
    expect(totalDuration(emptyStoryboard())).toBe(0);
  });

  test("总时长显示成 mm:ss，不足 1 秒的部分向上取整", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(65)).toBe("01:05");
    expect(formatDuration(3.3)).toBe("00:04");
    expect(formatDuration(3600)).toBe("60:00");
  });
});

describe("读档规整", () => {
  test("结构不对时读成空表", () => {
    expect(normalizeStoryboard(undefined, ids())).toEqual({ shots: [] });
    expect(normalizeStoryboard({ shots: "x" }, ids())).toEqual({ shots: [] });
  });

  test("不认识的景别、运镜清空，时长修正，缺字段补默认，缺 id 补新 id", () => {
    const raw = {
      shots: [
        { id: "a", scene: "开门", shot: "超大特写", camera: "推", duration: 120, extra: 1 },
        { scene: 5, dialogue: "你好", duration: "x" },
        "坏数据",
      ],
    };
    expect(normalizeStoryboard(raw, ids())).toEqual({
      shots: [
        {
          id: "a",
          scene: "开门",
          shot: "",
          camera: "推",
          action: "",
          dialogue: "",
          duration: 60,
        },
        { id: "s1", scene: "", shot: "", camera: "", action: "", dialogue: "你好", duration: 3 },
      ],
    });
  });

  test("重复的 id 换成新的，镜号不会错位", () => {
    const next = normalizeStoryboard({ shots: [shot("a"), shot("a")] }, ids());
    expect(next.shots.map((s) => s.id)).toEqual(["a", "s1"]);
  });
});
