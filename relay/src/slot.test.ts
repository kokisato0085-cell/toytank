import { describe, it, expect } from "vitest";
import { nextFreeSlot } from "./slot";

describe("nextFreeSlot（ゲストのスロット割当・§12-l）", () => {
  it("空室なら最小の1を割り当てる", () => {
    expect(nextFreeSlot([], 3)).toBe(1);
  });

  it("順に埋まっていれば次の最小を割り当てる", () => {
    expect(nextFreeSlot([1], 3)).toBe(2);
    expect(nextFreeSlot([1, 2], 3)).toBe(3);
  });

  it("中抜け（例: 2が退出）した空きを最小優先で再利用する", () => {
    expect(nextFreeSlot([1, 3], 3)).toBe(2);
    expect(nextFreeSlot([2, 3], 3)).toBe(1);
  });

  it("満室（1〜3すべて使用中）なら -1", () => {
    expect(nextFreeSlot([1, 2, 3], 3)).toBe(-1);
  });

  it("重複や無効値(-1)が混じっても正しく空きを返す", () => {
    expect(nextFreeSlot([-1, 1, 1], 3)).toBe(2);
  });
});
