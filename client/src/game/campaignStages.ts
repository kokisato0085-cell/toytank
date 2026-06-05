// 同梱のソロ・キャンペーン（20ステージ）。
// localStorage にユーザー作成のキャンペーンが無いとき、main.ts がこれを既定で再生する。
// 設計方針：
//  - 難易度カーブ：敵種・数・ギミック（穴・壊せる壁・地雷・透明・回避・ボス）を段階的に追加。
//  - ギミックを各面で活用（中央要塞・通路・穴のピット・壊せる壁の遮蔽 など）。
//  - リスポーン地点（=プレイヤー開始位置）の近くに、遮蔽なしで敵を湧かせない
//    （敵は十分離すか、間に鋼/壊せる壁を挟む）。campaignStages.test.ts で自動チェック。
// グリッドは 20×15・cell64 で統一。外周は鋼。座標は [col, row]（col:1..18, row:1..13）。

import { createEmptyStage, fillBorderSteel } from "../stage/edit";
import { TILE } from "../stage/types";
import type { CellPos, EnemySpec, StageData } from "../stage/types";

type XY = [number, number];

// 1ステージを組み立てる小ヘルパー。
function build(
  name: string,
  opts: { steel?: XY[]; brick?: XY[]; hole?: XY[]; player: XY; enemies: [number, number, string][] },
): StageData {
  const s = fillBorderSteel(createEmptyStage(20, 15, 64));
  s.name = name;
  for (const [c, r] of opts.steel ?? []) s.tiles[r][c] = TILE.STEEL;
  for (const [c, r] of opts.brick ?? []) s.tiles[r][c] = TILE.BRICK;
  for (const [c, r] of opts.hole ?? []) s.tiles[r][c] = TILE.HOLE;
  s.players = [{ col: opts.player[0], row: opts.player[1] } as CellPos];
  s.enemies = opts.enemies.map(([col, row, pattern]) => ({ col, row, pattern }) as EnemySpec);
  return s;
}

export function campaignStages(): StageData[] {
  return [
    // 1: 操作・射撃に慣れる（砲台1体・中央に小壁）
    build("camp-01", {
      steel: [[10, 6], [10, 7], [10, 8]],
      player: [2, 12],
      enemies: [[16, 3, "wood"]],
    }),
    // 2: 複数の的（柱の陰）
    build("camp-02", {
      steel: [[6, 4], [6, 5], [13, 9], [13, 10]],
      player: [2, 12],
      enemies: [[16, 2, "wood"], [16, 7, "wood"], [11, 3, "wood"]],
    }),
    // 3: 動く的（カイト）。縦の仕切り
    build("camp-03", {
      steel: [[9, 3], [9, 4], [9, 10], [9, 11]],
      player: [2, 12],
      enemies: [[16, 7, "gray"], [12, 2, "wood"], [16, 12, "wood"]],
    }),
    // 4: 跳弾を撃つ（バンク砲台）。中央ブロックで反射を使わせる
    build("camp-04", {
      steel: [[9, 6], [10, 6], [9, 7], [10, 7], [14, 4], [14, 10]],
      player: [2, 12],
      enemies: [[16, 4, "stationary"], [8, 2, "wood"]],
    }),
    // 5: 穴の導入（中央ピット）
    build("camp-05", {
      steel: [[5, 3], [15, 11]],
      hole: [[9, 6], [10, 6], [9, 7], [10, 7], [9, 8], [10, 8]],
      player: [2, 12],
      enemies: [[16, 2, "stationary"], [16, 12, "gray"], [9, 3, "wood"]],
    }),
    // 6: 壊せる壁・跳弾回避（黄緑＝2回反射）。横断する壊せる壁
    build("camp-06", {
      steel: [[4, 4], [15, 10]],
      brick: [[7, 7], [8, 7], [9, 7], [10, 7], [11, 7], [12, 7]],
      player: [2, 12],
      enemies: [[16, 3, "yellowgreen"], [16, 11, "wood"]],
    }),
    // 7: 接近戦（中央通路の上下に壁）
    build("camp-07", {
      steel: [[8, 5], [9, 5], [10, 5], [11, 5], [8, 9], [9, 9], [10, 9], [11, 9]],
      player: [2, 12],
      enemies: [[16, 3, "pink"], [16, 11, "gray"], [10, 3, "wood"]],
    }),
    // 8: 高速ミサイル（縦通路で射線を切る）
    build("camp-08", {
      steel: [[6, 3], [6, 4], [6, 5], [6, 6], [13, 8], [13, 9], [13, 10], [13, 11]],
      player: [2, 12],
      enemies: [[16, 4, "darkgreen"], [16, 11, "stationary"]],
    }),
    // 9: 地雷の脅威（開けた四隅の柱＝地雷を避ける余地）
    build("camp-09", {
      steel: [[7, 5], [12, 5], [7, 10], [12, 10]],
      player: [2, 12],
      enemies: [[15, 4, "yellow"], [15, 11, "wood"]],
    }),
    // 10: 小山場（混成）。ピット＋壊せる壁＋四隅の柱
    build("camp-10", {
      steel: [[4, 3], [15, 3], [4, 11], [15, 11]],
      brick: [[6, 6], [6, 7], [13, 7], [13, 8]],
      hole: [[9, 7], [10, 7]],
      player: [2, 12],
      enemies: [[16, 2, "pink"], [16, 11, "yellow"], [9, 3, "yellowgreen"]],
    }),
    // 11: 弾幕（5連射バンク）。中央要塞で遮蔽
    build("camp-11", {
      steel: [[8, 7], [9, 7], [10, 7], [11, 7]],
      brick: [[8, 5], [11, 5], [8, 9], [11, 9]],
      player: [2, 12],
      enemies: [[16, 7, "purple"], [16, 2, "gray"]],
    }),
    // 12: 距離詰め（穴で機動を制限）
    build("camp-12", {
      steel: [[5, 4], [14, 10]],
      hole: [[9, 6], [10, 6], [9, 9], [10, 9]],
      player: [2, 12],
      enemies: [[16, 3, "pink"], [16, 11, "darkgreen"], [10, 2, "wood"]],
    }),
    // 13: 高速追跡（黒）。射線を切る縦壁＋壊せる壁
    build("camp-13", {
      steel: [[6, 4], [6, 5], [6, 6], [12, 7], [12, 8], [12, 9]],
      brick: [[9, 3], [9, 11]],
      player: [2, 12],
      enemies: [[16, 7, "black"], [16, 2, "wood"]],
    }),
    // 14: 弾避け相手（銀）。段差状の壁＋小穴
    build("camp-14", {
      steel: [[8, 5], [9, 5], [11, 9], [12, 9]],
      hole: [[10, 7]],
      player: [2, 12],
      enemies: [[16, 7, "silver"], [16, 2, "stationary"]],
    }),
    // 15: 透明（白）。四隅の壁＋中央の壊せる壁で位置を推測
    build("camp-15", {
      steel: [[6, 5], [13, 5], [6, 10], [13, 10]],
      brick: [[9, 7], [10, 7]],
      player: [2, 12],
      enemies: [[16, 7, "white"], [16, 2, "gray"]],
    }),
    // 16: 地雷＋弾幕。壊せる壁の小部屋
    build("camp-16", {
      steel: [[4, 3], [15, 11]],
      brick: [[7, 6], [8, 6], [11, 6], [12, 6], [7, 9], [8, 9], [11, 9], [12, 9]],
      player: [2, 12],
      enemies: [[16, 2, "purple"], [16, 11, "yellow"]],
    }),
    // 17: 高速＆回避混戦。四隅の柱＋中央ピット
    build("camp-17", {
      steel: [[7, 5], [12, 5], [7, 10], [12, 10]],
      hole: [[9, 7], [10, 7], [9, 8], [10, 8]],
      player: [2, 12],
      enemies: [[16, 3, "black"], [16, 11, "silver"], [10, 2, "pink"]],
    }),
    // 18: 透明＋追跡。射線を切る壁
    build("camp-18", {
      steel: [[6, 4], [6, 5], [13, 9], [13, 10]],
      brick: [[9, 6], [10, 8]],
      player: [2, 12],
      enemies: [[16, 3, "white"], [16, 11, "black"]],
    }),
    // 19: 準ボス級総力戦。中央要塞＋左右の穴
    build("camp-19", {
      steel: [[8, 5], [9, 5], [10, 5], [11, 5], [8, 9], [9, 9], [10, 9], [11, 9]],
      brick: [[9, 7], [10, 7]],
      hole: [[4, 7], [15, 7]],
      player: [2, 12],
      enemies: [[16, 2, "purple"], [16, 11, "black"], [12, 3, "yellow"], [12, 11, "gray"]],
    }),
    // 20: ボス戦（ボス＋護衛）。アリーナの四隅壁＋ボス手前の壊せる壁＋左右の穴
    build("camp-20", {
      steel: [[5, 4], [14, 4], [5, 10], [14, 10]],
      brick: [[9, 7], [10, 7]],
      hole: [[3, 7], [16, 7]],
      player: [10, 13],
      enemies: [[10, 4, "boss"], [4, 11, "gray"], [16, 11, "gray"]],
    }),
  ];
}
