import { describe, it, expect } from "vitest";
import { createEmptyStage, fillBorderSteel } from "../stage/edit";
import { TILE } from "../stage/types";
import { advanceBullet, bulletsCollide, type Bullet } from "./bullet";

// 5×4・外周鋼。内部床 col1..3 / row1..2、cell=64。
function freshStage() {
  return fillBorderSteel(createEmptyStage(5, 4, 64));
}
function bullet(p: Partial<Bullet>): Bullet {
  return { x: 0, y: 0, vx: 0, vy: 0, bounces: 1, owner: 0, age: 0, ...p };
}

describe("advanceBullet", () => {
  it("開けた場所では直進し続ける", () => {
    const s = freshStage();
    const b = bullet({ x: 160, y: 160, vx: 100, vy: 0 });
    expect(advanceBullet(s, b, 0.1)).toBe(true);
    expect(b.x).toBeCloseTo(170);
    expect(b.y).toBeCloseTo(160);
  });

  it("鋼に当たると反射し、反射回数を消費する", () => {
    const s = freshStage();
    // col3(x192..256)床から右の外周鋼(col4)へ
    const b = bullet({ x: 250, y: 160, vx: 600, vy: 0, bounces: 1 });
    expect(advanceBullet(s, b, 0.1)).toBe(true);
    expect(b.vx).toBe(-600); // 反転
    expect(b.bounces).toBe(0);
  });

  it("反射回数が尽きた状態で壁に当たると消滅", () => {
    const s = freshStage();
    const b = bullet({ x: 250, y: 160, vx: 600, vy: 0, bounces: 0 });
    expect(advanceBullet(s, b, 0.1)).toBe(false);
  });

  it("壊せる壁に当たると壁を壊して消滅", () => {
    const s = freshStage();
    s.tiles[2][3] = TILE.BRICK; // col3,row2 に壊せる壁
    const b = bullet({ x: 160, y: 160, vx: 600, vy: 0, bounces: 1 }); // col2→col3へ
    expect(advanceBullet(s, b, 0.1)).toBe(false);
    expect(s.tiles[2][3]).toBe(TILE.FLOOR); // 破壊された
  });
});

describe("bulletsCollide", () => {
  it("近接していれば衝突、離れていれば非衝突", () => {
    expect(bulletsCollide(bullet({ x: 100, y: 100 }), bullet({ x: 105, y: 100 }))).toBe(true);
    expect(bulletsCollide(bullet({ x: 100, y: 100 }), bullet({ x: 140, y: 100 }))).toBe(false);
  });
});
