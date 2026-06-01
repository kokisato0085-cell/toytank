import { describe, it, expect } from "vitest";
import { createEmptyStage, fillBorderSteel } from "../stage/edit";
import { TILE } from "../stage/types";
import { blastReaches, computeAimDir, lineClear } from "./ai";

// 7×5・外周鋼。内部床 col1..5 / row1..3、cell=64。row2 中心の y=160。
function room() {
  return fillBorderSteel(createEmptyStage(7, 5, 64));
}

describe("lineClear", () => {
  it("開けた直線は通る", () => {
    expect(lineClear(room(), 100, 160, 380, 160)).toBe(true);
  });
  it("壁を挟むと通らない", () => {
    const s = room();
    s.tiles[2][3] = TILE.STEEL; // col3,row2 に壁
    expect(lineClear(s, 100, 160, 380, 160)).toBe(false);
  });
});

describe("blastReaches", () => {
  it("間に壁が無ければ届く", () => {
    expect(blastReaches(room(), 100, 160, 300, 160)).toBe(true);
  });
  it("間に壁があれば届かない", () => {
    const s = room();
    s.tiles[2][3] = TILE.STEEL;
    expect(blastReaches(s, 100, 160, 360, 160)).toBe(false);
  });
  it("対象が壊せる壁自身なら、その壁は遮蔽に数えず届く", () => {
    const s = room();
    s.tiles[2][3] = TILE.BRICK; // col3,row2
    expect(blastReaches(s, 100, 160, 224, 160)).toBe(true); // 224=col3中心付近
  });
});

describe("computeAimDir", () => {
  it("直射が通れば対象方向を返す", () => {
    const dir = computeAimDir(room(), 100, 160, 380, 160);
    expect(dir).not.toBeNull();
    expect(dir!.x).toBeGreaterThan(0.9); // ほぼ +x
    expect(Math.abs(dir!.y)).toBeLessThan(0.1);
  });

  it("正面が壁でも、反射で回り込める射線があれば方向を返す", () => {
    const s = room();
    s.tiles[2][3] = TILE.STEEL; // 直射を遮る
    const dir = computeAimDir(s, 100, 160, 380, 160);
    // 直射不可だが、上下面での反射解が見つかる想定（y成分を持つ）
    expect(dir).not.toBeNull();
    expect(Math.abs(dir!.y)).toBeGreaterThan(0.1);
  });

  it("allowBank=false（移動型）なら、直射不可のとき null", () => {
    const s = room();
    s.tiles[2][3] = TILE.STEEL;
    expect(computeAimDir(s, 100, 160, 380, 160, false)).toBeNull();
  });
});
