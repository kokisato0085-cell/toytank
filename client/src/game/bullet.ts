// 弾の物理（BasicDesign §6）。直進し、壁で反射（軸平行・反射回数上限）、
// 壊せる壁に当たると破壊して消滅。命中（戦車）判定は呼び出し側（ゲームループ）で行う。

import { TILE } from "../stage/types";
import type { StageData } from "../stage/types";
import { isSolidCell } from "./physics";

export interface Bullet {
  x: number;
  y: number;
  vx: number; // px/s
  vy: number;
  bounces: number; // 残り反射回数
  owner: number; // 発射者（0=自機, 1..=敵）。FF・自爆猶予に使う
  age: number; // 経過秒
}

// 1ステップ進める。壁反射・壊せる壁破壊を処理する。弾が消滅すべきなら false を返す。
// stage は壊せる壁の破壊で書き換わる。
export function advanceBullet(stage: StageData, b: Bullet, dt: number): boolean {
  const cell = stage.grid.cell;
  let nx = b.x + b.vx * dt;
  let ny = b.y + b.vy * dt;

  // X 軸方向の壁
  {
    const col = Math.floor(nx / cell);
    const row = Math.floor(b.y / cell);
    if (isSolidCell(stage, col, row)) {
      if (stage.tiles[row]?.[col] === TILE.BRICK) {
        stage.tiles[row][col] = TILE.FLOOR;
        return false; // 壊せる壁を壊して消滅
      }
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
    if (isSolidCell(stage, col, row)) {
      if (stage.tiles[row]?.[col] === TILE.BRICK) {
        stage.tiles[row][col] = TILE.FLOOR;
        return false;
      }
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
