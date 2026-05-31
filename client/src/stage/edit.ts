// ステージ編集の純粋関数（ToyTank Maker が利用）。
// DOM に依存せずテスト可能にするため、UI から分離する（関心の分離）。

import { TILE } from "./types";
import type { StageData, TileValue } from "./types";

// 指定サイズの空ステージ（全マス床・配置なし）を作る。
export function createEmptyStage(cols: number, rows: number, cell: number, name = "stage"): StageData {
  const tiles: TileValue[][] = [];
  for (let r = 0; r < rows; r++) {
    tiles.push(new Array<TileValue>(cols).fill(TILE.FLOOR));
  }
  return { name, grid: { cols, rows, cell }, tiles, players: [], enemies: [] };
}

// 外周1マスを鋼壁で囲んだ新しいステージを返す（弾・戦車の場外防止）。内側は変更しない。
export function fillBorderSteel(s: StageData): StageData {
  const { cols, rows } = s.grid;
  const tiles = s.tiles.map((line, r) =>
    line.map((v, c) => (r === 0 || r === rows - 1 || c === 0 || c === cols - 1 ? TILE.STEEL : v)),
  );
  return { ...s, tiles };
}

// グリッドサイズを変更した新しいステージを返す。
// 既存タイルは重なる範囲を維持し、増えたマスは床。範囲外になった配置は取り除く。
export function resizeStage(s: StageData, newCols: number, newRows: number): StageData {
  const tiles: TileValue[][] = [];
  for (let r = 0; r < newRows; r++) {
    const line: TileValue[] = [];
    for (let c = 0; c < newCols; c++) {
      const inOld = r < s.grid.rows && c < s.grid.cols;
      line.push(inOld ? s.tiles[r][c] : TILE.FLOOR);
    }
    tiles.push(line);
  }
  const inBounds = (col: number, row: number) => col >= 0 && col < newCols && row >= 0 && row < newRows;
  return {
    ...s,
    grid: { ...s.grid, cols: newCols, rows: newRows },
    tiles,
    players: s.players.filter((p) => inBounds(p.col, p.row)),
    enemies: s.enemies.filter((e) => inBounds(e.col, e.row)),
  };
}
