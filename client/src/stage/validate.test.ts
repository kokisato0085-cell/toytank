import { describe, it, expect } from "vitest";
import { validateStage } from "./validate";
import type { StageData, TileValue } from "./types";

// 5×4 の妥当なステージ（外周=鋼1, 内側=床0）。P1とP2と敵1体を床に配置。
//   col→ 0 1 2 3 4
// row0   1 1 1 1 1
// row1   1 0 0 0 1
// row2   1 0 0 0 1
// row3   1 1 1 1 1
function makeValidStage(): StageData {
  const tiles: TileValue[][] = [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ];
  return {
    name: "test",
    grid: { cols: 5, rows: 4, cell: 64 },
    tiles,
    players: [
      { col: 1, row: 1 },
      { col: 1, row: 2 },
    ],
    enemies: [{ col: 3, row: 1, pattern: "stationary" }],
  };
}

describe("validateStage", () => {
  it("妥当なステージはエラーなし", () => {
    expect(validateStage(makeValidStage())).toEqual([]);
  });

  it("tiles の行数が grid.rows と不一致ならエラー", () => {
    const s = makeValidStage();
    s.tiles.pop(); // 4行→3行
    expect(validateStage(s).join()).toMatch(/行数/);
  });

  it("tiles の列数が grid.cols と不一致ならエラー", () => {
    const s = makeValidStage();
    s.tiles[1] = [0, 0, 0, 0]; // 5列→4列
    expect(validateStage(s).join()).toMatch(/列数/);
  });

  it("不正なタイル値はエラー", () => {
    const s = makeValidStage();
    (s.tiles[1] as number[])[1] = 9;
    expect(validateStage(s).join()).toMatch(/不正/);
  });

  it("P1 がなければエラー", () => {
    const s = makeValidStage();
    s.players = [];
    expect(validateStage(s).join()).toMatch(/P1/);
  });

  it("プレイヤーが3つ以上はエラー", () => {
    const s = makeValidStage();
    s.players = [
      { col: 1, row: 1 },
      { col: 2, row: 1 },
      { col: 3, row: 2 },
    ];
    expect(validateStage(s).join()).toMatch(/最大2/);
  });

  it("敵が0体ならエラー", () => {
    const s = makeValidStage();
    s.enemies = [];
    expect(validateStage(s).join()).toMatch(/敵は1体以上/);
  });

  it("開始セルが壁（床でない）ならエラー", () => {
    const s = makeValidStage();
    s.players[0] = { col: 0, row: 0 }; // 鋼の上
    expect(validateStage(s).join()).toMatch(/床ではありません/);
  });

  it("開始位置がマップ外ならエラー", () => {
    const s = makeValidStage();
    s.enemies[0] = { col: 99, row: 1, pattern: "mover" };
    expect(validateStage(s).join()).toMatch(/マップ外/);
  });

  it("開始位置の重複はエラー", () => {
    const s = makeValidStage();
    s.enemies[0] = { col: 1, row: 1, pattern: "mover" }; // P1と同じセル
    expect(validateStage(s).join()).toMatch(/重複/);
  });
});
