// ゲーム本体のエントリ（段階1）。
// 既定では ToyTank Maker のキャンペーン（順番リスト）を上から再生（クリアで次へ）。
// URL ?stage=<名前> で単一ステージ、?stage=__sample__ で同梱サンプルを遊べる。

import { sampleStage } from "./game/sampleStage";
import { Game } from "./game/game";
import { validateStage } from "./stage/validate";
import { listSavedStages, loadCampaign, loadSavedStage, stageLoadErrors } from "./game/stageStore";
import { isMuted, setMuted, startBgm, toggleMuted, unlockSound } from "./game/sound";
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
let loadMsg = "";
let loadFailed = false;
if (want === SAMPLE_KEY) {
  stage = sampleStage();
  loadMsg = "サンプルをプレイ中";
} else if (want) {
  const loaded = loadSavedStage(want);
  if (loaded) {
    stage = loaded;
    loadMsg = `「${want}」をプレイ中`;
  } else {
    stage = sampleStage();
    loadFailed = true;
    loadMsg = `⚠「${want}」を読み込めません → サンプル表示中。理由：${stageLoadErrors(want).join(" / ")}`;
  }
} else if (campaign.length > 0) {
  campaignMode = true;
  stage = campaign[0];
  loadMsg = "キャンペーンをプレイ中";
} else {
  stage = sampleStage();
  loadMsg = "サンプルをプレイ中（保存ステージがありません）";
}

const errs = validateStage(stage);
if (errs.length) console.warn("ステージ検証エラー:", errs);

const statusEl = document.getElementById("load-status");
if (statusEl) {
  statusEl.textContent = loadMsg;
  statusEl.style.color = loadFailed ? "#c0392b" : "#555";
}

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

// 操作モード（PC/スマホ）。既定はタッチ端末ならスマホ、それ以外はPC。設定は記憶。
const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
const ctrlMode = (localStorage.getItem("toytank.ctrlmode") as "mobile" | "pc" | null) ?? (touch ? "mobile" : "pc");
game.setInputMode(ctrlMode);
const modeSel = document.getElementById("ctrl-mode") as HTMLSelectElement | null;
if (modeSel) {
  modeSel.value = ctrlMode;
  modeSel.addEventListener("change", () => {
    const m = modeSel.value as "mobile" | "pc";
    localStorage.setItem("toytank.ctrlmode", m);
    game.setInputMode(m);
  });
}

if (campaignMode) {
  game.onStageClear = () => {
    idx++;
    if (idx < campaign.length) {
      game.loadStage(campaign[idx], false); // 残機は引き継ぐ
      game.beginStage(`ステージ ${idx + 1}`);
    }
    // 最後のステージをクリアしたら "CLEAR!" のまま（全クリア）
  };
  game.beginStage("ステージ 1"); // 初回の区切り画面
}

game.start();

document.getElementById("btn-mine")?.addEventListener("click", () => game.layMine());

// 音：最初のユーザー操作で再生を解除（スマホの自動再生制約対応）
const unlock = (): void => {
  unlockSound();
  startBgm(0.2); // 初回操作でBGM開始（頭から）
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
  window.removeEventListener("touchstart", unlock);
};
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);
window.addEventListener("touchstart", unlock);

// ミュート切替ボタン
const muteBtn = document.getElementById("btn-mute");
if (muteBtn) {
  const sync = (): void => {
    muteBtn.textContent = isMuted() ? "🔇 音 OFF" : "🔊 音 ON";
  };
  setMuted(isMuted()); // 保存値を反映
  sync();
  muteBtn.addEventListener("click", () => {
    toggleMuted();
    unlockSound(); // 解除も兼ねる
    sync();
  });
}

function restart(): void {
  if (campaignMode) {
    idx = 0;
    game.loadStage(campaign[0], true); // 残機リセットで最初から
    game.beginStage("ステージ 1");
  } else {
    game.restart();
  }
}
document.getElementById("btn-restart")?.addEventListener("click", restart);
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "r") restart();
});
