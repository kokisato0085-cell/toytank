// 敵AIの照準計算（BasicDesign §10）。
// 直射が通れば直接狙う。遮蔽で通らなければ、場外4面での1回反射（バンクショット）を試す。
// 射線が通る方向（正規化ベクトル）を返す。撃てる解がなければ null。

import { isSolidCell } from "./physics";
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
    if (isSolidCell(stage, col, row)) return false;
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
    if (isSolidCell(stage, col, row)) return false;
  }
  return true;
}

function norm(x: number, y: number): { x: number; y: number } {
  const m = Math.hypot(x, y) || 1;
  return { x: x / m, y: y / m };
}

// 敵(ex,ey)から対象(px,py)を撃つ方向。直射→（allowBank時のみ）バンクショットの順に探す。
export function computeAimDir(
  stage: StageData,
  ex: number,
  ey: number,
  px: number,
  py: number,
  allowBank = true,
): { x: number; y: number } | null {
  if (lineClear(stage, ex, ey, px, py)) return norm(px - ex, py - ey);
  if (!allowBank) return null; // 直射のみ（移動型）

  // バンクショット：場外境界の内側面（1セル枠を想定）で対象を鏡像化し、1回反射の射線を探す。
  const { cell, cols, rows } = stage.grid;
  const W = cols * cell;
  const H = rows * cell;
  type Face = { vertical: boolean; f: number };
  const faces: Face[] = [
    { vertical: true, f: cell }, // 左
    { vertical: true, f: W - cell }, // 右
    { vertical: false, f: cell }, // 上
    { vertical: false, f: H - cell }, // 下
  ];
  for (const fc of faces) {
    const mx = fc.vertical ? 2 * fc.f - px : px;
    const my = fc.vertical ? py : 2 * fc.f - py;
    const ddx = mx - ex;
    const ddy = my - ey;
    const denom = fc.vertical ? ddx : ddy;
    if (denom === 0) continue;
    const t = (fc.f - (fc.vertical ? ex : ey)) / denom;
    if (t <= 0.02 || t >= 0.98) continue;
    const hx = ex + ddx * t;
    const hy = ey + ddy * t;
    if (lineClear(stage, ex, ey, hx, hy) && lineClear(stage, hx, hy, px, py)) {
      return norm(ddx, ddy);
    }
  }
  return null;
}
