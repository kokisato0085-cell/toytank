// ゲーム本体のエントリ（段階1）。
// 既定では ToyTank Maker のキャンペーン（順番リスト）を上から再生（クリアで次へ）。
// URL ?stage=<名前> で単一ステージ、?stage=__sample__ で同梱サンプルを遊べる。

import { sampleStage } from "./game/sampleStage";
import { Game } from "./game/game";
import { validateStage } from "./stage/validate";
import { listSavedStages, loadCampaign, loadSavedStage } from "./game/stageStore";
import type { StageData } from "./stage/types";

const SAMPLE_KEY = "__sample__";

const params = new URLSearchParams(location.search);
const want = params.get("stage");

// キャンペーン（順番リスト）を解決（有効なステージのみ）。
const campaign: StageData[] = loadCampaign()
  .map(loadSavedStage)
  .filter((s): s is StageData => s !== null);

// 再生対象の決定
let stage: StageData;
let campaignMode = false;
let idx = 0;
if (want === SAMPLE_KEY) {
  stage = sampleStage();
} else if (want) {
  stage = loadSavedStage(want) ?? sampleStage();
} else if (campaign.length > 0) {
  campaignMode = true;
  stage = campaign[0];
} else {
  stage = sampleStage();
}

const errs = validateStage(stage);
if (errs.length) console.warn("ステージ検証エラー:", errs);

// ステージ選択セレクタ
const sel = document.getElementById("stage-select") as HTMLSelectElement | null;
if (sel) {
  const names = listSavedStages();
  const opts: { value: string; label: string }[] = [];
  if (campaign.length > 0) opts.push({ value: "", label: "▶ キャンペーン（順番）" });
  opts.push({ value: SAMPLE_KEY, label: "サンプル" });
  for (const n of names) opts.push({ value: n, label: n });
  sel.innerHTML = "";
  for (const o of opts) {
    const el = document.createElement("option");
    el.value = o.value;
    el.textContent = o.label;
    sel.appendChild(el);
  }
  sel.value = want ?? (campaign.length > 0 ? "" : SAMPLE_KEY);
  sel.addEventListener("change", () => {
    const p = new URLSearchParams();
    if (sel.value) p.set("stage", sel.value);
    location.search = p.toString();
  });
}

const canvas = document.getElementById("game") as HTMLCanvasElement | null;
if (!canvas) throw new Error("canvas#game が見つかりません");

const game = new Game(canvas, stage);

if (campaignMode) {
  game.onStageClear = () => {
    idx++;
    if (idx < campaign.length) game.loadStage(campaign[idx], false); // 残機は引き継ぐ
    // 最後のステージをクリアしたら "CLEAR!" のまま（全クリア）
  };
}

game.start();

document.getElementById("btn-mine")?.addEventListener("click", () => game.layMine());

function restart(): void {
  if (campaignMode) {
    idx = 0;
    game.loadStage(campaign[0], true); // 残機リセットで最初から
  } else {
    game.restart();
  }
}
document.getElementById("btn-restart")?.addEventListener("click", restart);
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "r") restart();
});
