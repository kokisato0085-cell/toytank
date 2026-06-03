// 弾の物理（BasicDesign §6）。直進し、壁で反射（軸平行・反射回数上限）、
// 壊せる壁に当たると破壊して消滅。命中（戦車）判定は呼び出し側（ゲームループ）で行う。

import type { StageData } from "../stage/types";
import { isWallCell } from "./physics";
import { BULLET_RADIUS } from "./constants";

export interface Bullet {
  x: number;
  y: number;
  vx: number; // px/s
  vy: number;
  bounces: number; // 残り反射回数
  owner: number; // 発射者（0=自機, 1..=敵）。FF・自爆猶予に使う
  age: number; // 経過秒
  group: number; // 発射グループ（同一斉射は同じ番号＝相殺しない）
}

// 1ステップ進める。壁（鋼・壊せる壁とも）で反射する。弾が消滅すべきなら false を返す。
// ※壊せる壁は弾では壊れない（地雷の爆発でのみ破壊）。命中（戦車・地雷）判定は呼び出し側。
export function advanceBullet(stage: StageData, b: Bullet, dt: number): boolean {
  const cell = stage.grid.cell;
  let nx = b.x + b.vx * dt;
  let ny = b.y + b.vy * dt;

  // X 軸方向の壁
  {
    const col = Math.floor(nx / cell);
    const row = Math.floor(b.y / cell);
    if (isWallCell(stage, col, row)) {
      if (b.bounces <= 0) return false; // 反射上限超過で消滅
      b.bounces--;
      b.vx = -b.vx;
      nx = b.x; // 壁にめり込ませない
    }
  }
  // Y 軸方向の壁（X 解決後の位置で判定）
  {
    const col = Math.floor(nx / cell);
    const row = Math.floor(ny / cell);
    if (isWallCell(stage, col, row)) {
      if (b.bounces <= 0) return false;
      b.bounces--;
      b.vy = -b.vy;
      ny = b.y;
    }
  }

  b.x = nx;
  b.y = ny;
  b.age += dt;
  return true;
}

// 2発の弾が接触しているか（両半径の和以内）。
export function bulletsCollide(a: Bullet, b: Bullet): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const d = BULLET_RADIUS * 2;
  return dx * dx + dy * dy < d * d;
}
