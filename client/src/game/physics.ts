// 移動と壁の当たり判定（BasicDesign §8）。
// 戦車は半径 r の円。壁セル（鋼=1／壊せる=2）と場外を「ソリッド」として扱い、
// 円とセル矩形の重なりで判定する。移動は軸別に適用して壁ずりを実現する。

import { TILE } from "../stage/types";
import type { StageData } from "../stage/types";

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// セルがソリッドか。範囲外は壁扱い（場外に出さない）。
export function isSolidCell(stage: StageData, col: number, row: number): boolean {
  const { cols, rows } = stage.grid;
  if (col < 0 || col >= cols || row < 0 || row >= rows) return true;
  return stage.tiles[row][col] !== TILE.FLOOR;
}

// 中心(x,y)・半径 r の円が、いずれかのソリッドセルと重なるか。
export function circleHitsSolid(stage: StageData, x: number, y: number, r: number): boolean {
  const { cell } = stage.grid;
  const minCol = Math.floor((x - r) / cell);
  const maxCol = Math.floor((x + r) / cell);
  const minRow = Math.floor((y - r) / cell);
  const maxRow = Math.floor((y + r) / cell);
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (!isSolidCell(stage, col, row)) continue;
      // セル矩形上の最近点までの距離が r 未満なら重なり。
      const rx = col * cell;
      const ry = row * cell;
      const nx = clamp(x, rx, rx + cell);
      const ny = clamp(y, ry, ry + cell);
      const dx = x - nx;
      const dy = y - ny;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

// (x,y) から (nx,ny) への移動を軸別に解決する（壁ずり）。
// blocked(px,py) が「その中心位置が塞がれているか」を返す。X を先に、次に解決済みXのまま Y を試す。
export function slide(
  x: number,
  y: number,
  nx: number,
  ny: number,
  blocked: (px: number, py: number) => boolean,
): { x: number; y: number } {
  let rx = nx;
  if (blocked(rx, y)) rx = x;
  let ry = ny;
  if (blocked(rx, ry)) ry = y;
  return { x: rx, y: ry };
}

// 壁（ソリッドセル・場外）に対する移動解決。
export function resolveMove(
  stage: StageData,
  x: number,
  y: number,
  nx: number,
  ny: number,
  r: number,
): { x: number; y: number } {
  return slide(x, y, nx, ny, (px, py) => circleHitsSolid(stage, px, py, r));
}
