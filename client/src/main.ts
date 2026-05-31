// ゲーム本体のエントリ（段階1）。
// 現ステップ：サンプルステージで自機を操作して動かせる（移動＋壁ずり）。
// 以降、射撃・地雷・敵AI などを順次追加していく。

import { sampleStage } from "./game/sampleStage";
import { Game } from "./game/game";
import { validateStage } from "./stage/validate";

const stage = sampleStage();
const errs = validateStage(stage);
if (errs.length) console.warn("ステージ検証エラー:", errs);

const canvas = document.getElementById("game") as HTMLCanvasElement | null;
if (!canvas) throw new Error("canvas#game が見つかりません");

new Game(canvas, stage).start();
