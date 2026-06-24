// チュートリアル専用ステージ（BasicDesign §15）。
// 公式キャンペーン（campaignStages.ts）・自作（localStorage）とは混ぜない読み取り専用データ。
// 開けたアリーナ＋地雷で壊す壊せる壁＋仕上げ用の木戦車1体だけ、というシンプル構成。
// グリッドは没入(16:9)に合わせて 28×15・cell64。外周は鋼。座標は [col, row]。

import { createEmptyStage, fillBorderSteel } from "../stage/edit";
import { TILE } from "../stage/types";
import type { CellPos, EnemySpec, StageData } from "../stage/types";

export function tutorialStage(): StageData {
  const s = fillBorderSteel(createEmptyStage(28, 15, 64, "tutorial"));
  // 地雷ステップ用の壊せる壁（中央やや左の短い縦壁）。プレイヤーが近づいて地雷で壊す。
  const brick: [number, number][] = [
    [11, 6],
    [11, 7],
    [11, 8],
  ];
  for (const [c, r] of brick) s.tiles[r][c] = TILE.BRICK;
  // 開始位置は中央左の開けた床。
  s.players = [{ col: 6, row: 7 } as CellPos];
  // 仕上げの木戦車1体（右側）。実際の出現はステップ5到達時（game.ts が遅延スポーン）。
  s.enemies = [{ col: 21, row: 7, pattern: "wood" } as EnemySpec];
  return s;
}
