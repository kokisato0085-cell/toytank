// ゲーム本体のエントリ（段階1）。
// ToyTank Maker（localStorage）の保存ステージ、または同梱サンプルを読み込んで遊ぶ。
// 現ステップ：自機を操作して動かせる（移動＋壁ずり、敵は障害物）。

import { sampleStage } from "./game/sampleStage";
import { Game } from "./game/game";
import { validateStage } from "./stage/validate";
import { listSavedStages, loadSavedStage } from "./game/stageStore";
import type { StageData } from "./stage/types";

const SAMPLE = "（サンプル）";

// URL ?stage=<name> があればそれを、なければサンプルを読む。
const params = new URLSearchParams(location.search);
const want = params.get("stage");

let stage: StageData = sampleStage();
if (want && want !== SAMPLE) {
  const loaded = loadSavedStage(want);
  if (loaded) stage = loaded;
}
const errs = validateStage(stage);
if (errs.length) console.warn("ステージ検証エラー:", errs);

// ステージ選択セレクタ（サンプル＋保存マップ）。変更で URL を切り替えて再読み込み。
const sel = document.getElementById("stage-select") as HTMLSelectElement | null;
if (sel) {
  const names = listSavedStages();
  sel.innerHTML = "";
  for (const n of [SAMPLE, ...names]) {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  }
  sel.value = want && names.includes(want) ? want : SAMPLE;
  sel.addEventListener("change", () => {
    const p = new URLSearchParams();
    if (sel.value !== SAMPLE) p.set("stage", sel.value);
    location.search = p.toString();
  });
}

const canvas = document.getElementById("game") as HTMLCanvasElement | null;
if (!canvas) throw new Error("canvas#game が見つかりません");

const game = new Game(canvas, stage);
game.start();

const mineBtn = document.getElementById("btn-mine");
if (mineBtn) mineBtn.addEventListener("click", () => game.layMine());
