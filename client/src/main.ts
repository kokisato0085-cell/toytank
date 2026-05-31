// ゲーム本体のエントリ（段階1）。
// 現ステップ：サンプルステージを読み込み、マップと戦車・敵を静止描画する。
// 以降、移動・射撃・敵AI などを順次追加していく。

import { sampleStage } from "./game/sampleStage";
import { renderStage, worldSize } from "./game/render";
import { validateStage } from "./stage/validate";

const stage = sampleStage();
const errs = validateStage(stage);
if (errs.length) console.warn("ステージ検証エラー:", errs);

const canvas = document.getElementById("game") as HTMLCanvasElement | null;
if (!canvas) throw new Error("canvas#game が見つかりません");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D コンテキストを取得できません");

// 画面幅に合わせて等倍率で縮小表示する。
const { w, h } = worldSize(stage);
const maxW = Math.min(760, window.innerWidth - 20);
const scale = maxW / w;
canvas.width = Math.round(w * scale);
canvas.height = Math.round(h * scale);
ctx.scale(scale, scale);

renderStage(ctx, stage);
