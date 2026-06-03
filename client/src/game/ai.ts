// 敵AIの照準計算（BasicDesign §10）。
// 直射が通れば直接狙う。遮蔽で通らなければ、壁（外壁・内壁すべて）で反射する
// バンクショットを軌道シミュレーションで探索する。反射回数は弾の bounces 分まで。
// 射線が通る方向（正規化ベクトル）を返す。撃てる解がなければ null。

import { isWallCell } from "./physics";
import { BULLET_RADIUS, TANK_RADIUS } from "./constants";
import type { StageData } from "../stage/types";

// 線分 (x1,y1)-(x2,y2) が壁セルに遮られていないか（端点付近は除外してサンプリング）。
export function lineClear(stage: StageData, x1: number, y1: number, x2: number, y2: number): boolean {
  const { cell } = stage.grid;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const n = Math.max(2, Math.ceil(len / (cell / 3)));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const col = Math.floor((x1 + dx * t) / cell);
    const row = Math.floor((y1 + dy * t) / cell);
    if (isWallCell(stage, col, row)) return false;
  }
  return true;
}

// 爆心(mx,my)から対象(tx,ty)へ、間に壁があるか（壁があれば爆風は届かない）。
// 対象自身のセル（壊せる壁など）は遮蔽に数えない。
export function blastReaches(stage: StageData, mx: number, my: number, tx: number, ty: number): boolean {
  const { cell } = stage.grid;
  const tcol = Math.floor(tx / cell);
  const trow = Math.floor(ty / cell);
  const dx = tx - mx;
  const dy = ty - my;
  const len = Math.hypot(dx, dy);
  const n = Math.max(2, Math.ceil(len / (cell / 3)));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const col = Math.floor((mx + dx * t) / cell);
    const row = Math.floor((my + dy * t) / cell);
    if (col === tcol && row === trow) continue; // 対象セルは無視
    if (isWallCell(stage, col, row)) return false;
  }
  return true;
}

function norm(x: number, y: number): { x: number; y: number } {
  const m = Math.hypot(x, y) || 1;
  return { x: x / m, y: y / m };
}

// 点(px,py)から線分(ax,ay)-(bx,by)への距離。
function segDist(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return Math.hypot(px - cx, py - cy);
}

// 命中とみなす最接近距離（戦車半径＋弾半径の少し内側）。
const HIT_TOL = TANK_RADIUS + BULLET_RADIUS * 0.5;

// 仮想弾を(ex,ey)から単位方向(ux,uy)へ撃ち、maxBounce 回反射までに対象(px,py)へ
// どれだけ近づけるか（最接近距離）を返す。実弾と同じく外壁・内壁すべてで反射する。
function traceClosest(
  stage: StageData,
  ex: number,
  ey: number,
  ux: number,
  uy: number,
  px: number,
  py: number,
  maxBounce: number,
  maxDist: number,
): number {
  const cell = stage.grid.cell;
  const step = cell * 0.25; // 1ステップの進み（セルの1/4）
  let x = ex;
  let y = ey;
  let vx = ux;
  let vy = uy;
  let bounces = maxBounce;
  let traveled = 0;
  let best = Infinity;
  const skip = TANK_RADIUS * 1.5; // 発射直後の自分付近は無視（自爆距離を当てない）
  const guard = Math.ceil(maxDist / step) + 8;
  for (let s = 0; s < guard && traveled < maxDist; s++) {
    let nx = x + vx * step;
    let ny = y + vy * step;
    // X 軸方向の壁
    {
      const col = Math.floor(nx / cell);
      const row = Math.floor(y / cell);
      if (isWallCell(stage, col, row)) {
        if (bounces <= 0) return best;
        bounces--;
        vx = -vx;
        nx = x;
      }
    }
    // Y 軸方向の壁
    {
      const col = Math.floor(nx / cell);
      const row = Math.floor(ny / cell);
      if (isWallCell(stage, col, row)) {
        if (bounces <= 0) return best;
        bounces--;
        vy = -vy;
        ny = y;
      }
    }
    if (traveled > skip) {
      const d = segDist(x, y, nx, ny, px, py);
      if (d < best) best = d;
      if (best <= HIT_TOL) return best;
    }
    traveled += Math.hypot(nx - x, ny - y);
    x = nx;
    y = ny;
  }
  return best;
}

// 敵(ex,ey)から対象(px,py)を撃つ方向。直射→（allowBank時のみ）バンクショットの順に探す。
// maxBank: バンクの最大反射回数（弾の bounces 分。黄緑なら2回反射まで）。
// バンクは実弾の反射物理を軌道シミュレーションでなぞり、外壁・内壁すべての反射を使う。
export function computeAimDir(
  stage: StageData,
  ex: number,
  ey: number,
  px: number,
  py: number,
  allowBank = true,
  maxBank = 1,
): { x: number; y: number } | null {
  if (lineClear(stage, ex, ey, px, py)) return norm(px - ex, py - ey);
  if (!allowBank || maxBank < 1) return null; // 直射のみ

  const { cell, cols, rows } = stage.grid;
  const W = cols * cell;
  const H = rows * cell;
  // 反射回数に応じて十分な飛距離を確保（打ち切り距離）
  const maxDist = (W + H) * (maxBank + 1);

  // 粗探索：全方位を等間隔にサンプリングし、最接近が最小の方向を探す
  const COARSE = 180;
  let bestAng = 0;
  let bestD = Infinity;
  for (let i = 0; i < COARSE; i++) {
    const ang = (i / COARSE) * Math.PI * 2;
    const d = traceClosest(stage, ex, ey, Math.cos(ang), Math.sin(ang), px, py, maxBank, maxDist);
    if (d < bestD) {
      bestD = d;
      bestAng = ang;
    }
  }
  // 精探索：粗探索の最良方向の周辺を細かく詰める
  const span = (Math.PI * 2) / COARSE;
  const R = 12;
  for (let j = -R; j <= R; j++) {
    const ang = bestAng + (j / R) * span;
    const d = traceClosest(stage, ex, ey, Math.cos(ang), Math.sin(ang), px, py, maxBank, maxDist);
    if (d < bestD) {
      bestD = d;
      bestAng = ang;
    }
  }
  if (bestD > HIT_TOL) return null; // 当てられる解なし
  return { x: Math.cos(bestAng), y: Math.sin(bestAng) };
}
