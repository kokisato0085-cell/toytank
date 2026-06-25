import { describe, expect, it } from "vitest";
import { tutorialStage } from "./tutorialStage";
import { validateStage } from "../stage/validate";
import { TILE } from "../stage/types";

describe("チュートリアル練習ステージ（BasicDesign §15）", () => {
  const s = tutorialStage();

  it("検証エラーなし（配置が壁/重複/範囲外でない・敵タイプが妥当）", () => {
    expect(validateStage(s), validateStage(s).join(" / ")).toEqual([]);
  });

  it("没入(16:9)に合わせた 28×15 グリッド", () => {
    expect(s.grid.cols).toBe(28);
    expect(s.grid.rows).toBe(15);
  });

  it("地雷ステップ用の壊せる壁がある", () => {
    const bricks = s.tiles.flat().filter((t) => t === TILE.BRICK).length;
    expect(bricks).toBeGreaterThan(0);
  });

  it("仕上げ用に木戦車(wood)が1体だけ", () => {
    expect(s.enemies.length).toBe(1);
    expect(s.enemies[0].pattern).toBe("wood");
  });
});
