// 移動と壁の当たり判定（BasicDesign §8）。
// 戦車は半径 r の円。壁セル（鋼=1／壊せる=2）と場外を「ソリッド」として扱い、
// 円とセル矩形の重なりで判定する。移動は軸別に適用して壁ずりを実現する。

import { TILE } from "../stage/types";
import type { StageData } from "../stage/types";

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// 戦車にとってソリッドか（床以外＝鋼・壊せる壁・穴は通れない）。範囲外も壁扱い。
export function isSolidCell(stage: StageData, col: number, row: number): boolean {
  const { cols, rows } = stage.grid;
  if (col < 0 || col >= cols || row < 0 || row >= rows) return true;
  return stage.tiles[row][col] !== TILE.FLOOR;
}

// 弾・射線・爆風を遮る壁か（鋼・壊せる壁・場外のみ。穴と床は通す）。
export function isWallCell(stage: StageData, col: number, row: number): boolean {
  const { cols, rows } = stage.grid;
  if (col < 0 || col >= cols || row < 0 || row >= rows) return true;
  const t = stage.tiles[row][col];
  return t === TILE.STEEL || t === TILE.BRICK;
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

// 軌道シミュレーション用の点の状態（位置・速度・残り反射回数）。
// 実弾(advanceBullet)・AIの照準/同士討ち判定(ai.ts)・弾避け予測(game.ts)で共有する。
export interface RayStep {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bounces: number; // 残り反射回数
}

// (x,y) を速度 (vx,vy) で dt 進める。壁（鋼・壊せる壁・場外）で軸平行反射し、反射ごとに bounces を1消費する。
// 反射回数を使い切った状態で壁に当たったら false（＝弾は消滅すべき）。壁が無ければ位置・速度を更新して true。
// X→Y の順で軸別に解決する（実弾とAI予測で同一の反射物理を使うための共通実装）。
export function stepReflect(stage: StageData, s: RayStep, dt: number): boolean {
  const { cell } = stage.grid;
  let nx = s.x + s.vx * dt;
  let ny = s.y + s.vy * dt;
  // X 軸方向の壁（移動前の y で判定）
  {
    const col = Math.floor(nx / cell);
    const row = Math.floor(s.y / cell);
    if (isWallCell(stage, col, row)) {
      if (s.bounces <= 0) return false;
      s.bounces--;
      s.vx = -s.vx;
      nx = s.x; // 壁にめり込ませない
    }
  }
  // Y 軸方向の壁（X 解決後の位置で判定）
  {
    const col = Math.floor(nx / cell);
    const row = Math.floor(ny / cell);
    if (isWallCell(stage, col, row)) {
      if (s.bounces <= 0) return false;
      s.bounces--;
      s.vy = -s.vy;
      ny = s.y;
    }
  }
  s.x = nx;
  s.y = ny;
  return true;
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
