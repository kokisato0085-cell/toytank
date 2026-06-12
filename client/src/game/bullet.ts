// 弾の物理（BasicDesign §6）。直進し、壁で反射（軸平行・反射回数上限）、
// 壊せる壁に当たると破壊して消滅。命中（戦車）判定は呼び出し側（ゲームループ）で行う。

import type { StageData } from "../stage/types";
import { stepReflect } from "./physics";
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
  // Bullet は RayStep（x/y/vx/vy/bounces）を満たすので、共通の反射シミュレーションへ委譲する。
  if (!stepReflect(stage, b, dt)) return false; // 反射上限超過で消滅
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
