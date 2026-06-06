// アプリシェル（段階1）。タイトル → モード選択 → ゲーム/設定/自作一覧 を画面状態で切替える。
// 公式キャンペーンは campaignStages()（コード）が唯一の出所＝読み取り専用。
// 自作ステージは localStorage（ToyTank Maker が保存）から読む。両者は混ざらない。
// 画面構成の設計: docs/BasicDesign.md §1.1。

import { campaignStages } from "./game/campaignStages";
import { Game } from "./game/game";
import { listSavedStages, loadSavedStage } from "./game/stageStore";
import {
  getVolume,
  isMuted,
  setMuted,
  setVolume,
  startBgm,
  stopBgm,
  toggleMuted,
  unlockSound,
} from "./game/sound";
import type { StageData } from "./stage/types";

// ---- 画面切替 ----
type ScreenId = "title" | "settings" | "custom" | "game";
function showScreen(id: ScreenId): void {
  for (const el of document.querySelectorAll<HTMLElement>(".screen")) {
    el.classList.toggle("active", el.id === `screen-${id}`);
  }
}
function onGameScreen(): boolean {
  return document.getElementById("screen-game")?.classList.contains("active") ?? false;
}
function setStatus(msg: string): void {
  const el = document.getElementById("load-status");
  if (el) el.textContent = msg;
}

// ---- ゲーム本体（遅延生成・単一インスタンス）----
const canvas = document.getElementById("game") as HTMLCanvasElement | null;
if (!canvas) throw new Error("canvas#game が見つかりません");

let game: Game | null = null;
let campaign: StageData[] = []; // 現在プレイ中の並び（ソロ＝公式20面 / 自作＝単発1面）
let idx = 0;
let campaignMode = false; // true=公式キャンペーン進行 / false=単発（自作）

const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
let ctrlMode = (localStorage.getItem("toytank.ctrlmode") as "mobile" | "pc" | null) ?? (touch ? "mobile" : "pc");

// Game を用意（初回のみ生成。以後は使い回し）。
function bootGame(stage: StageData): Game {
  if (!game) {
    const g = new Game(canvas!, stage);
    g.setInputMode(ctrlMode);
    g.onStageClear = () => {
      if (!campaignMode) return; // 自作の単発は1面クリアで全クリア（"CLEAR!"のまま）
      const cleared = idx + 1; // ここまでにクリアした面数
      idx++;
      if (idx < campaign.length) {
        const healed = cleared % 5 === 0 ? g.gainLife() : false; // 5面ごと残機+1
        g.loadStage(campaign[idx], false); // 残機は引き継ぐ
        g.beginStage(`ステージ ${idx + 1}`, healed);
        startBgm(0.2); // 次ステージはBGMを頭から
      }
    };
    g.start();
    game = g;
  }
  return game;
}

function enterGame(): void {
  showScreen("game");
  game?.resume();
  unlockSound();
  startBgm(0.2); // ミュート時は内部で無音
}

function backToTitle(): void {
  game?.pause();
  stopBgm();
  showScreen("title");
}

// ---- 各モードの開始 ----
function startSolo(): void {
  campaign = campaignStages(); // 公式20面（コードが唯一の出所）
  campaignMode = true;
  idx = 0;
  const g = bootGame(campaign[0]);
  g.loadStage(campaign[0], true); // 残機リセットで最初から
  g.beginStage("ステージ 1");
  setStatus("キャンペーンをプレイ中");
  enterGame();
}

function startCustom(name: string): void {
  const s = loadSavedStage(name);
  if (!s) {
    alert(`「${name}」を読み込めません`);
    return;
  }
  campaign = [s];
  campaignMode = false;
  idx = 0;
  const g = bootGame(s);
  g.loadStage(s, true);
  g.beginStage(name);
  setStatus(`自作「${name}」をプレイ中`);
  enterGame();
}

// ---- 自作ステージ一覧 ----
function buildCustomList(): void {
  const names = listSavedStages();
  const list = document.getElementById("custom-list");
  const empty = document.getElementById("custom-empty");
  if (!list || !empty) return;
  list.innerHTML = "";
  empty.style.display = names.length ? "none" : "block";
  for (const n of names) {
    const b = document.createElement("button");
    b.textContent = `▶ ${n}`;
    b.addEventListener("click", () => startCustom(n));
    list.appendChild(b);
  }
}

// ---- 設定（全体音量＋ミュート）----
const volSlider = document.getElementById("set-volume") as HTMLInputElement | null;
const volVal = document.getElementById("set-volume-val");
const muteChk = document.getElementById("set-mute") as HTMLInputElement | null;
function syncSettings(): void {
  if (volSlider) volSlider.value = String(Math.round(getVolume() * 100));
  if (volVal) volVal.textContent = `${Math.round(getVolume() * 100)}%`;
  if (muteChk) muteChk.checked = isMuted();
}
volSlider?.addEventListener("input", () => {
  const v = parseInt(volSlider.value, 10) / 100;
  setVolume(v);
  unlockSound();
  if (volVal) volVal.textContent = `${volSlider.value}%`;
});
muteChk?.addEventListener("change", () => {
  setMuted(muteChk.checked);
  unlockSound();
  syncGameMuteBtn();
});

// ---- タイトルメニュー／戻るボタン（data-action）----
for (const el of document.querySelectorAll<HTMLElement>("[data-action]")) {
  el.addEventListener("click", () => {
    switch (el.dataset.action) {
      case "solo":
        startSolo();
        break;
      case "custom":
        game?.pause();
        buildCustomList();
        showScreen("custom");
        break;
      case "settings":
        game?.pause();
        syncSettings();
        showScreen("settings");
        break;
      case "title":
        backToTitle();
        break;
    }
  });
}

// ---- 操作モード（PC/スマホ）----
const modeSel = document.getElementById("ctrl-mode") as HTMLSelectElement | null;
if (modeSel) {
  modeSel.value = ctrlMode;
  modeSel.addEventListener("change", () => {
    ctrlMode = modeSel.value as "mobile" | "pc";
    localStorage.setItem("toytank.ctrlmode", ctrlMode);
    game?.setInputMode(ctrlMode);
  });
}

// ---- ゲーム画面のボタン ----
document.getElementById("btn-mine")?.addEventListener("click", () => game?.layMine());

const muteBtn = document.getElementById("btn-mute");
function syncGameMuteBtn(): void {
  if (muteBtn) muteBtn.textContent = isMuted() ? "🔇 音 OFF" : "🔊 音 ON";
}
setMuted(isMuted()); // 保存値を反映
syncGameMuteBtn();
muteBtn?.addEventListener("click", () => {
  toggleMuted();
  unlockSound();
  syncGameMuteBtn();
});

function restart(): void {
  if (!game) return;
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
  if (e.key.toLowerCase() === "r" && onGameScreen()) restart();
});

// ---- 音：最初のユーザー操作で再生解除（スマホの自動再生制約対応）----
const unlock = (): void => {
  unlockSound();
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
  window.removeEventListener("touchstart", unlock);
};
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);
window.addEventListener("touchstart", unlock);

showScreen("title"); // 起動時はタイトル
