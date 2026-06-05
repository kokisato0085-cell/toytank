import { describe, expect, it } from "vitest";
import { campaignStages } from "./campaignStages";
import { validateStage } from "../stage/validate";
import type { CellPos, StageData } from "../stage/types";

// プレイヤー(p)と敵(e)のセル直線上に鋼(1)/壊せる壁(2)があるか（=遮蔽あり）。穴(3)は弾が通るので遮蔽に数えない。
function hasCover(s: StageData, p: CellPos, e: { col: number; row: number }): boolean {
  const steps = 28;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const col = Math.round(p.col + (e.col - p.col) * t);
    const row = Math.round(p.row + (e.row - p.row) * t);
    const v = s.tiles[row][col];
    if (v === 1 || v === 2) return true;
  }
  return false;
}

describe("同梱キャンペーン（20ステージ）", () => {
  const stages = campaignStages();

  it("ちょうど20ステージある", () => {
    expect(stages.length).toBe(20);
  });

  it("すべて検証エラーなし（配置が壁/重複/範囲外でない・敵タイプが妥当）", () => {
    for (const s of stages) {
      expect(validateStage(s), `${s.name}: ${validateStage(s).join(" / ")}`).toEqual([]);
    }
  });

  it("名前が一意", () => {
    const names = stages.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // リスポーン地点（=P1開始位置）の近くに、遮蔽なしで敵を湧かせない。
  it("プレイヤー開始位置の近く(5.5セル未満)に遮蔽なしの敵がいない", () => {
    const SAFE = 5.5;
    for (const s of stages) {
      const p = s.players[0];
      for (const e of s.enemies) {
        const d = Math.hypot(e.col - p.col, e.row - p.row);
        const ok = d >= SAFE || hasCover(s, p, e);
        expect(ok, `${s.name}: 敵(${e.col},${e.row})が開始位置(${p.col},${p.row})に近く遮蔽なし（距離${d.toFixed(1)}）`).toBe(true);
      }
    }
  });
});
