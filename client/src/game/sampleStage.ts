// 動作確認用のサンプルステージ（後で ToyTank Maker 製のデータに差し替え可能）。
// 20×15・外周は鋼。中央付近に鋼と壊せる壁を少し配置し、両プレイヤーと敵2体を置く。

import { createEmptyStage, fillBorderSteel } from "../stage/edit";
import { TILE } from "../stage/types";
import type { StageData } from "../stage/types";

export function sampleStage(): StageData {
  const s = fillBorderSteel(createEmptyStage(20, 15, 64));
  s.name = "sample-01";

  const steel: [number, number][] = [
    [9, 4], [10, 4], [9, 5], [10, 5], // 中央上の鋼ブロック
    [6, 9], [6, 10], // 左下の柱
    [13, 4], [13, 5], // 右上の柱
  ];
  const brick: [number, number][] = [
    [8, 7], [9, 7], [10, 7], [11, 7], // 中央の壊せる壁ライン
    [3, 6], [16, 8],
  ];
  for (const [c, r] of steel) s.tiles[r][c] = TILE.STEEL;
  for (const [c, r] of brick) s.tiles[r][c] = TILE.BRICK;

  s.players = [
    { col: 2, row: 12 },
    { col: 3, row: 12 },
  ];
  s.enemies = [
    { col: 16, row: 2, pattern: "stationary" },
    { col: 10, row: 11, pattern: "mover" },
  ];
  return s;
}
