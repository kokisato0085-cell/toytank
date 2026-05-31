import { describe, it, expect } from "vitest";
import { createEmptyStage, fillBorderSteel, resizeStage } from "./edit";
import { TILE } from "./types";

describe("createEmptyStage", () => {
  it("全マス床・配置なしの矩形ステージを作る", () => {
    const s = createEmptyStage(5, 4, 64);
    expect(s.grid).toEqual({ cols: 5, rows: 4, cell: 64 });
    expect(s.tiles.length).toBe(4);
    expect(s.tiles.every((row) => row.length === 5)).toBe(true);
    expect(s.tiles.flat().every((v) => v === TILE.FLOOR)).toBe(true);
    expect(s.players).toEqual([]);
    expect(s.enemies).toEqual([]);
  });
});

describe("fillBorderSteel", () => {
  it("外周だけ鋼にし内側は床のまま", () => {
    const s = fillBorderSteel(createEmptyStage(5, 4, 64));
    // 四隅・辺は鋼
    expect(s.tiles[0][0]).toBe(TILE.STEEL);
    expect(s.tiles[3][4]).toBe(TILE.STEEL);
    expect(s.tiles[0][2]).toBe(TILE.STEEL);
    expect(s.tiles[2][0]).toBe(TILE.STEEL);
    // 内側は床
    expect(s.tiles[1][1]).toBe(TILE.FLOOR);
    expect(s.tiles[2][3]).toBe(TILE.FLOOR);
  });

  it("元のステージを破壊しない（新オブジェクトを返す）", () => {
    const base = createEmptyStage(3, 3, 64);
    fillBorderSteel(base);
    expect(base.tiles.flat().every((v) => v === TILE.FLOOR)).toBe(true);
  });
});

describe("resizeStage", () => {
  it("拡大：既存範囲を保持し、増えたマスは床", () => {
    const s0 = fillBorderSteel(createEmptyStage(3, 3, 64));
    const s1 = resizeStage(s0, 5, 4);
    expect(s1.grid).toEqual({ cols: 5, rows: 4, cell: 64 });
    expect(s1.tiles[0][0]).toBe(TILE.STEEL); // 旧データ保持
    expect(s1.tiles[0][4]).toBe(TILE.FLOOR); // 新規マスは床
    expect(s1.tiles[3][0]).toBe(TILE.FLOOR);
  });

  it("縮小：範囲外になった配置を取り除く", () => {
    const s0 = createEmptyStage(6, 6, 64);
    s0.players = [{ col: 1, row: 1 }];
    s0.enemies = [{ col: 5, row: 5, pattern: "mover" }]; // 縮小後は範囲外
    const s1 = resizeStage(s0, 3, 3);
    expect(s1.players).toEqual([{ col: 1, row: 1 }]);
    expect(s1.enemies).toEqual([]);
  });
});
