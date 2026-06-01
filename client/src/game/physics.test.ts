import { describe, it, expect } from "vitest";
import { createEmptyStage, fillBorderSteel } from "../stage/edit";
import { TILE } from "../stage/types";
import { circleHitsSolid, isSolidCell, isWallCell, resolveMove, slide } from "./physics";

// 5×4・外周鋼。内部の床セルは col1..3 / row1..2、cell=64。
// セル中心 (col,row) のワールド座標 = ((col+0.5)*64, (row+0.5)*64)
const stage = fillBorderSteel(createEmptyStage(5, 4, 64));
const R = 24;

describe("isSolidCell", () => {
  it("外周は鋼=ソリッド、内部は床=非ソリッド、範囲外もソリッド", () => {
    expect(isSolidCell(stage, 0, 0)).toBe(true); // 外周
    expect(isSolidCell(stage, 2, 2)).toBe(false); // 内部床
    expect(isSolidCell(stage, -1, 2)).toBe(true); // 範囲外
  });
});

describe("穴(HOLE) の扱い", () => {
  const s = fillBorderSteel(createEmptyStage(5, 4, 64));
  s.tiles[2][2] = TILE.HOLE;
  it("戦車にはソリッド（通れない）", () => {
    expect(isSolidCell(s, 2, 2)).toBe(true);
  });
  it("弾・射線・爆風は通す（壁ではない）", () => {
    expect(isWallCell(s, 2, 2)).toBe(false);
  });
});

describe("circleHitsSolid", () => {
  it("内部の開けた場所では当たらない", () => {
    expect(circleHitsSolid(stage, 160, 160, R)).toBe(false); // セル(2,2)中心
  });
  it("下の壁(row3)に重なると当たる", () => {
    expect(circleHitsSolid(stage, 160, 260, R)).toBe(true); // y260 は床外・鋼に近接
  });
});

describe("resolveMove", () => {
  it("開けた方向へはそのまま進む", () => {
    const res = resolveMove(stage, 160, 160, 200, 160, R);
    expect(res).toEqual({ x: 200, y: 160 });
  });

  it("壁に正面衝突する軸は止まる", () => {
    // 下(row3鋼)へ向かう → Y は進めない
    const res = resolveMove(stage, 160, 160, 160, 260, R);
    expect(res.y).toBe(160);
  });

  it("壁ずり：塞がれた軸は止まり、空いた軸へは進む", () => {
    // 左下へ：左(X)は空き→進む、下(Y)は鋼→止まる
    const res = resolveMove(stage, 160, 160, 120, 260, R);
    expect(res.x).toBe(120);
    expect(res.y).toBe(160);
  });
});

describe("slide（汎用：任意の blocked 判定で壁ずり）", () => {
  // x>=150 を塞がれた領域とする。
  const blocked = (px: number, _py: number) => px >= 150;
  it("塞がれたX軸は止まり、Y軸へは進む", () => {
    const res = slide(100, 100, 160, 140, blocked);
    expect(res.x).toBe(100); // Xは塞がれ据え置き
    expect(res.y).toBe(140); // Yは通る
  });
});
