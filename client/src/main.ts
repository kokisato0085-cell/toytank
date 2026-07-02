// アプリシェル（段階1）。タイトル → モード選択 → ゲーム/設定/自作一覧 を画面状態で切替える。
// 公式キャンペーンは campaignStages()（コード）が唯一の出所＝読み取り専用。
// 自作ステージは localStorage（ToyTank Maker が保存）から読む。両者は混ざらない。
// 画面構成の設計: docs/BasicDesign.md §1.1。

import { campaignStages } from "./game/campaignStages";
import { tutorialStage } from "./game/tutorialStage";
import { Game, type Snapshot } from "./game/game";
import { RelayClient, type LobbyMsg } from "./net/relay";
import { listSavedStages, loadSavedStage, saveCampaign } from "./game/stageStore";
import {
  getVolume,
  isMuted,
  setMuted,
  setSuppressed,
  setVolume,
  startBgm,
  stopBgm,
  toggleMuted,
  unlockSound,
} from "./game/sound";
import type { StageData } from "./stage/types";

// ---- 画面切替 ----
type ScreenId = "title" | "settings" | "custom" | "coop" | "game";
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
      idx++;
      if (idx < campaign.length) {
        g.loadStage(campaign[idx], false); // 残機は引き継ぐ
        setClearGrant(); // このステージのクリアで+1するか（5/10/15）
        g.beginStage(`ステージ ${idx + 1}`); // +1はクリア画面側で表示
        startBgm(0.2); // 次ステージはBGMを頭から
      }
    };
    g.onGameOver = () => showResult(); // 残機ゼロ → リザルト選択
    g.onCleared = () => showResult(); // 全クリア → リザルト選択
    g.onTutorialDone = () => backToTitle(); // チュートリアル完了 → タイトルへ
    g.start();
    game = g;
  }
  return game;
}

function isMobile(): boolean {
  return ctrlMode === "mobile";
}
function isPortrait(): boolean {
  return window.matchMedia("(orientation: portrait)").matches;
}

// スマホでゲーム開始時：横画面・全画面化を試みる（起点はモード選択タップ＝ユーザー操作）。
// Android Chrome は全画面＋向きロックが効く。iOS Safari は失敗するので回転案内でフォロー。
// 画面向きロックAPI（実験的でTSの型に無いため最小型でアクセス）。
type OrientationLockApi = { lock?: (o: string) => Promise<void>; unlock?: () => void };
function orientationApi(): OrientationLockApi | undefined {
  return screen.orientation as unknown as OrientationLockApi | undefined;
}

async function tryLandscapeFullscreen(): Promise<void> {
  const el = document.getElementById("screen-game");
  try {
    await el?.requestFullscreen?.();
  } catch {
    /* iOS等は不可：回転案内でフォロー */
  }
  try {
    await orientationApi()?.lock?.("landscape");
  } catch {
    /* 向きロック不可（iOS等） */
  }
}

async function exitFullscreen(): Promise<void> {
  try {
    orientationApi()?.unlock?.();
  } catch {
    /* 無視 */
  }
  try {
    // ゲーム自体(#screen-game)を全画面化していたスマホの没入だけ解除する。
    // 手動の全画面（設定/⚙＝ページ全体 documentElement）はタイトルに戻っても維持する。
    if (document.fullscreenElement && document.fullscreenElement === document.getElementById("screen-game")) {
      await document.exitFullscreen();
    }
  } catch {
    /* 無視 */
  }
}

const rotateHint = document.getElementById("rotate-hint");

// ゲームの稼働状態と回転案内を更新。
// スマホで縦持ちのときは、タイトル含む全画面で「横向きにしてください」案内を出す
// （ホーム画面も横画面に統一）。横持ちなら案内を消し、ゲーム画面なら再開する。
function updateGameActive(): void {
  const portrait = isMobile() && isPortrait();
  if (rotateHint) rotateHint.style.display = portrait ? "flex" : "none";
  if (onGameScreen() && !portrait) game?.resume();
  else game?.pause();
}
window.addEventListener("resize", updateGameActive);
window.addEventListener("orientationchange", updateGameActive);

const gameSection = document.getElementById("screen-game");

// 没入表示（スマホ）：CSSで画面いっぱい＋キャンバスをビューポート全体にフィット。
function setImmersive(on: boolean): void {
  gameSection?.classList.toggle("immersive", on);
  if (game) {
    game.immersive = on;
    game.refit();
  }
}

function enterGame(): void {
  hideResult();
  setGearOpen(false);
  showScreen("game");
  unlockSound();
  startBgm(0.2); // ミュート時は内部で無音
  if (isMobile()) {
    setImmersive(true); // まず擬似全画面（iOSでも効く）
    void tryLandscapeFullscreen(); // Androidは実全画面＋横ロックも追加で試行
  }
  updateGameActive(); // 横なら再開／縦なら案内＋停止
}

function backToTitle(): void {
  game?.pause();
  stopBgm();
  hideResult();
  setGearOpen(false);
  setTutorialUi(false); // チュートリアルのスキップボタンを隠す
  closeRelay(); // Co-op を抜ける＝切断
  setImmersive(false);
  void exitFullscreen();
  showScreen("title");
  demoOn(); // タイトル背景デモを再開
  updateGameActive(); // 縦持ちなら回転案内（ホームも横画面に）
}

// このステージをクリアすると残機+1か（公式キャンペーンの 5/10/15 クリア時）。
function setClearGrant(): void {
  if (game) game.clearGrantsLife = campaignMode && (idx + 1) % 5 === 0 && idx + 1 < campaign.length;
}

// ---- 各モードの開始 ----
function startSolo(startIdx = 0): void {
  demoOff(); // デモ停止＋実ゲームの音を有効化（loadStage の startBgm 前に）
  campaign = campaignStages(); // 公式20面（コードが唯一の出所）
  campaignMode = true;
  idx = Math.max(0, Math.min(startIdx, campaign.length - 1));
  const g = bootGame(campaign[idx]);
  g.loadStage(campaign[idx], true); // 残機リセットで最初から
  setClearGrant();
  g.beginStage(`ステージ ${idx + 1}`);
  setStatus("キャンペーンをプレイ中");
  enterGame();
}

function startCustom(name: string): void {
  const s = loadSavedStage(name);
  if (!s) {
    alert(`「${name}」を読み込めません`);
    return;
  }
  demoOff(); // デモ停止＋実ゲームの音を有効化
  campaign = [s];
  campaignMode = false;
  idx = 0;
  const g = bootGame(s);
  g.loadStage(s, true);
  g.beginStage(name);
  setStatus(`自作「${name}」をプレイ中`);
  enterGame();
}

// チュートリアル（BasicDesign §15）。練習ステージを単発で開始し、ステップ達成で進行。
function startTutorial(): void {
  demoOff(); // デモ停止＋実ゲームの音を有効化
  const s = tutorialStage();
  campaign = [s];
  campaignMode = false;
  idx = 0;
  const g = bootGame(s);
  g.startTutorial(s); // 無敵・ステップ進行を初期化（loadStage 込み）
  setTutorialUi(true); // スキップボタンを表示
  setStatus("チュートリアル");
  enterGame();
}

// チュートリアル中だけスキップボタンを出す（ゲーム画面に .tutorial-active を付与）。
function setTutorialUi(on: boolean): void {
  gameSection?.classList.toggle("tutorial-active", on);
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
      case "tutorial":
        startTutorial();
        break;
      case "custom":
        game?.pause();
        demoOff();
        buildCustomList();
        showScreen("custom");
        updateGameActive();
        break;
      case "coop":
        openCoop();
        break;
      case "settings":
        game?.pause();
        demoOff();
        syncSettings();
        showScreen("settings");
        updateGameActive();
        break;
      case "title":
        backToTitle();
        break;
    }
  });
}

// ---- PC用 設定タブ（⚙設定で開閉。💣地雷・🔊音・音量を収納）----
const pcPanel = document.getElementById("pc-panel");
const pcVol = document.getElementById("pc-volume") as HTMLInputElement | null;
const pcVolVal = document.getElementById("pc-volume-val");
document.getElementById("pc-gear")?.addEventListener("click", () => {
  const open = !pcPanel?.classList.contains("open");
  pcPanel?.classList.toggle("open", open);
  if (open && pcVol) {
    pcVol.value = String(Math.round(getVolume() * 100));
    if (pcVolVal) pcVolVal.textContent = `${Math.round(getVolume() * 100)}%`;
  }
});
pcVol?.addEventListener("input", () => {
  setVolume(parseInt(pcVol.value, 10) / 100);
  unlockSound();
  if (pcVolVal) pcVolVal.textContent = `${pcVol.value}%`;
});

// フルスクリーン切替（⛶）。ページ全体を全画面化。タイトル設定とゲーム中⚙設定の両方から呼べる。
// Game の fit は fullscreenElement を見てキャンバスを拡大する。
async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen?.();
  } catch {
    /* 非対応環境は無視 */
  }
}
document.getElementById("btn-fullscreen")?.addEventListener("click", () => void toggleFullscreen());
document.getElementById("set-fullscreen")?.addEventListener("click", () => void toggleFullscreen());
document.addEventListener("fullscreenchange", () => {
  const label = document.fullscreenElement ? "⛶ 全画面を解除" : "⛶ フルスクリーン";
  const a = document.getElementById("btn-fullscreen");
  const b = document.getElementById("set-fullscreen");
  if (a) a.textContent = label;
  if (b) b.textContent = label;
});

// ---- ゲーム画面のボタン ----
document.getElementById("btn-mine")?.addEventListener("click", () => game?.requestMine());
// チュートリアルのスキップ（⚙設定タブ／⚙ギアメニューの中。tutorial-active の時だけ表示）
document.getElementById("pc-skip")?.addEventListener("click", () => backToTitle());
document.getElementById("gear-skip")?.addEventListener("click", () => backToTitle());

// ---- Co-op マルチ（ロビー。BasicDesign §12-b）----
let relay: RelayClient | null = null;
let myCoopName = ""; // 自分の表示名（部屋作成/参加時に確定）

const coopNameInput = document.getElementById("coop-name") as HTMLInputElement | null;
// 名前欄の値を取り出す（前後空白除去・最大10文字）。
function readCoopName(): string {
  return (coopNameInput?.value ?? "").trim().slice(0, 10);
}
// 前回の名前を localStorage から復元して名前欄に入れる。
function prefillCoopName(): void {
  if (coopNameInput && !coopNameInput.value) coopNameInput.value = localStorage.getItem("toytank.name") ?? "";
}
// 現在の名前を確定して保存する。
function commitCoopName(): void {
  myCoopName = readCoopName();
  if (myCoopName) localStorage.setItem("toytank.name", myCoopName);
}

// ロビー画面のパネル（選択／ホスト待機／ゲスト入室／接続OK）を出し分ける。
function coopPanel(id: "choose" | "host" | "join" | "ready"): void {
  for (const p of ["choose", "host", "join", "ready"] as const) {
    const el = document.getElementById(`coop-${p}`);
    if (el) el.style.display = p === id ? "block" : "none";
  }
}

function closeRelay(): void {
  relay?.close();
  relay = null;
}

// Co-op 画面を開く。prefillCode があれば入室パネルに合言葉を入れた状態にする（?room= 用）。
function openCoop(prefillCode?: string): void {
  game?.pause();
  demoOff();
  closeRelay();
  showScreen("coop");
  prefillCoopName(); // 前回の名前を復元
  const status = document.getElementById("coop-join-status");
  if (status) status.textContent = "";
  if (prefillCode) {
    coopPanel("join");
    const inp = document.getElementById("coop-code-input") as HTMLInputElement | null;
    if (inp) inp.value = prefillCode.toUpperCase().slice(0, 4);
  } else {
    coopPanel("choose");
  }
  updateGameActive();
}

function coopJoinStatus(msg: string): void {
  const s = document.getElementById("coop-join-status");
  if (s) s.textContent = msg;
}

function onCoopLobby(m: LobbyMsg): void {
  switch (m.t) {
    case "created": {
      const el = document.getElementById("coop-code");
      if (el) el.textContent = m.code;
      coopPanel("host");
      break;
    }
    case "joined": // ゲスト：入室成功（相手＝ホストは既にいる）
    case "peer-joined": // ホスト：相手が入った
      showCoopReady(); // 2人そろった → ホストは「ゲーム開始」、ゲストは待機
      break;
    case "peer-left":
      closeRelay();
      alert("相手の接続が切れました");
      backToTitle();
      break;
    case "error":
      if (m.reason === "notfound") coopJoinStatus("その合言葉の部屋が見つかりません");
      else if (m.reason === "full") coopJoinStatus("満室です（すでに2人います）");
      else coopJoinStatus("接続エラー");
      coopPanel("join");
      closeRelay();
      break;
  }
}

// 2人そろった画面：ホストは「ゲーム開始」、ゲストは待機表示。
function showCoopReady(): void {
  coopPanel("ready");
  const isHost = relay?.role === "host";
  const startBtn = document.getElementById("coop-start");
  const wait = document.getElementById("coop-wait");
  if (startBtn) startBtn.style.display = isHost ? "block" : "none";
  if (wait) wait.style.display = isHost ? "none" : "block";
}

// ホスト/ゲスト共通の Co-op ゲーム開始。
function startCoopGame(role: "host" | "guest", stage: StageData): void {
  demoOff();
  campaign = [stage];
  campaignMode = false; // Co-op はキャンペーン進行に乗せない
  idx = 0;
  const g = bootGame(stage);
  if (role === "host") {
    g.onSnapshot = (snap) => relay?.send(snap); // 盤面を相手へ送る
    g.onInput = null;
    g.startCoopHost(stage);
    g.setPlayerName(0, myCoopName); // 自分=P1
  } else {
    g.onSnapshot = null;
    g.onInput = (msg) => relay?.send(msg); // 自分の操作をホストへ送る
    g.startCoopGuest(stage);
    g.setPlayerName(1, myCoopName); // 自分=P2（即時表示用。スナップショットでも上書き）
    relay?.send({ t: "name", name: myCoopName }); // 名前をホストへ通知
  }
  setStatus("Co-op プレイ中");
  enterGame();
}

// ホストが「ゲーム開始」を押した：ステージを相手へ送り、両者でゲーム開始。
function coopHostStart(): void {
  const stage = campaignStages()[2]; // MVP：まず1面（移動する敵がいる面で動作確認。将来はP2配置済みの各面へ）
  relay?.send({ t: "start", stage });
  startCoopGame("host", stage);
}

// 相手（ホスト）から届いたゲームメッセージ（開始通知・スナップショット）。
function onCoopGameMessage(data: unknown): void {
  const msg = data as { t?: string; stage?: StageData };
  if (msg.t === "start" && msg.stage) {
    startCoopGame("guest", msg.stage); // ゲスト：ホストの開始通知でステージを読み込む
  } else if (msg.t === "snapshot") {
    game?.applySnapshot(data as Snapshot); // ゲスト：盤面を受信
  } else if (msg.t === "input") {
    // ホスト：ゲストの操作（移動/照準/発射/地雷）を受信
    game?.applyRemoteInput(
      data as { ax: number; ay: number; aim: [number, number] | null; fires?: [number, number][]; mines?: number },
    );
  } else if (msg.t === "name") {
    game?.setPlayerName(1, (data as { name: string }).name); // ホスト：ゲスト(P2)の名前を受信
  }
}

function newRelay(): RelayClient {
  const r = new RelayClient();
  r.onLobby = onCoopLobby;
  r.onGameMessage = onCoopGameMessage;
  r.onError = () => {
    coopJoinStatus("リレーサーバーに接続できません（起動していない可能性）");
    coopPanel("join");
    closeRelay();
  };
  r.onClose = () => {
    // 予期せぬ切断（peer-left は上で処理済み＝こちらからclose済みなので来ない）
    if (!onGameScreen()) coopJoinStatus("接続が切れました");
    relay = null;
  };
  return r;
}

document.getElementById("coop-create")?.addEventListener("click", () => {
  commitCoopName();
  closeRelay();
  relay = newRelay();
  const el = document.getElementById("coop-code");
  if (el) el.textContent = "····";
  coopPanel("host");
  relay.connect("host");
});
document.getElementById("coop-show-join")?.addEventListener("click", () => {
  coopJoinStatus("");
  coopPanel("join");
});
document.getElementById("coop-cancel")?.addEventListener("click", () => {
  closeRelay();
  coopPanel("choose");
});
document.getElementById("coop-join-back")?.addEventListener("click", () => {
  closeRelay();
  coopJoinStatus("");
  coopPanel("choose");
});
function coopJoinGo(): void {
  const inp = document.getElementById("coop-code-input") as HTMLInputElement | null;
  const code = (inp?.value ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    coopJoinStatus("4文字の合言葉を入力してください");
    return;
  }
  commitCoopName();
  closeRelay();
  relay = newRelay();
  coopJoinStatus("接続中…");
  relay.connect("guest", code);
}
document.getElementById("coop-start")?.addEventListener("click", coopHostStart);
document.getElementById("coop-join-go")?.addEventListener("click", coopJoinGo);
document.getElementById("coop-code-input")?.addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter") coopJoinGo();
});

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
  if (game.coopRole === "guest") return; // Co-op のゲストはホストの操作に従う（自分では再開しない）
  if (game.coopRole === "host") {
    hideResult();
    game.restartCoop(campaign[0]); // 全滅リザルト→もう一度：同ステージを最初から（統計もリセット）
    updateGameActive();
    return;
  }
  if (game.tutorial) {
    startTutorial(); // チュートリアル中のリスタートは最初からやり直す
    return;
  }
  hideResult();
  if (campaignMode) {
    idx = 0;
    game.loadStage(campaign[0], true); // 残機リセットで最初から
    setClearGrant();
    game.beginStage("ステージ 1");
  } else {
    game.restart();
  }
  updateGameActive(); // 横なら再開
}

// ---- スマホ没入時：ギアメニュー（音量/リスタート/タイトル）・💣地雷・リザルト選択 ----
const gearPanel = document.getElementById("gear-panel");
const gearVol = document.getElementById("gear-volume") as HTMLInputElement | null;
const gearVolVal = document.getElementById("gear-volume-val");
const resultOverlay = document.getElementById("result-overlay");

function setGearOpen(open: boolean): void {
  gearPanel?.classList.toggle("open", open);
  if (open) {
    if (gearVol) gearVol.value = String(Math.round(getVolume() * 100));
    if (gearVolVal) gearVolVal.textContent = `${Math.round(getVolume() * 100)}%`;
    game?.pause(); // メニュー表示中は停止
  } else {
    updateGameActive(); // 閉じたら（横なら）再開
  }
}
function showResult(): void {
  resultOverlay?.classList.add("open");
  gameSection?.classList.add("result-open"); // 💣ボタンを隠す（下中央で重なるため）
}
function hideResult(): void {
  resultOverlay?.classList.remove("open");
  gameSection?.classList.remove("result-open");
}

document.getElementById("gear-btn")?.addEventListener("click", () => {
  setGearOpen(!gearPanel?.classList.contains("open"));
});
gearVol?.addEventListener("input", () => {
  setVolume(parseInt(gearVol.value, 10) / 100);
  unlockSound();
  if (gearVolVal) gearVolVal.textContent = `${gearVol.value}%`;
});
document.getElementById("gear-restart")?.addEventListener("click", () => {
  setGearOpen(false);
  restart();
});
document.getElementById("gear-title")?.addEventListener("click", () => backToTitle());
document.getElementById("gear-fullscreen")?.addEventListener("click", () => {
  setGearOpen(false);
  void toggleFullscreen();
});
// 💣はドラッグ移動中でも反応するよう pointerdown で即時発火（click はマルチタッチ中に抑制されがち）
document.getElementById("mobile-mine")?.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  game?.requestMine();
});
document.getElementById("result-restart")?.addEventListener("click", () => restart());
document.getElementById("result-title")?.addEventListener("click", () => backToTitle());
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

// ---- タイトル背景デモ（戦車AI同士のバトルを自動再生・無音）----
const demoCanvas = document.getElementById("demo-bg") as HTMLCanvasElement | null;
let demoGame: Game | null = null;
let demoIdx = 0;
const demoStages = campaignStages();

function startDemoStage(i: number): void {
  if (!demoGame) return;
  demoIdx = ((i % demoStages.length) + demoStages.length) % demoStages.length;
  demoGame.loadStage(demoStages[demoIdx], true); // → playing（無音は suppressed で担保）
}
function initDemo(): void {
  if (!demoCanvas) return;
  setSuppressed(true); // デモは無音（loadStage の startBgm も抑制）
  const g = new Game(demoCanvas, demoStages[0]);
  g.demo = true;
  g.onStageClear = null; // 単発扱い（全滅→cleared→次の面へ）
  g.onCleared = () => startDemoStage(demoIdx + 1);
  g.onGameOver = () => startDemoStage(demoIdx + 1);
  demoGame = g;
  startDemoStage(0);
  g.start();
  g.pause(); // 表示時に resume
}
function demoOn(): void {
  if (!demoGame) return;
  document.body.classList.add("demo-on");
  setSuppressed(true);
  demoGame.refit();
  demoGame.resume();
}
function demoOff(): void {
  document.body.classList.remove("demo-on");
  setSuppressed(false);
  demoGame?.pause();
}

initDemo();
showScreen("title"); // 起動時はタイトル
demoOn();
updateGameActive(); // 起動時に縦持ちなら回転案内（ホームも横画面に統一）

// 共有URL（?room=ABCD）で開いたら Co-op の入室画面を合言葉入り表示にする。
{
  const room = new URLSearchParams(location.search).get("room");
  if (room) openCoop(room);
}

// 開発用ショートカット（localhost のみ）。
if (import.meta.env.DEV) {
  const params = new URLSearchParams(location.search);
  // ?solo=N で任意ステージから開始（スクショ撮影等）。
  const soloParam = params.get("solo");
  if (soloParam) {
    const n = parseInt(soloParam, 10);
    if (Number.isFinite(n)) startSolo(n - 1); // 1始まり → idx
  }
  // ?seed で公式20面を localStorage へ書き出し → エディタで手直しできるようにする。
  if (params.has("seed")) {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("toytank.stage.")) localStorage.removeItem(k);
    }
    const names: string[] = [];
    for (const s of campaignStages()) {
      localStorage.setItem(`toytank.stage.${s.name}`, JSON.stringify(s));
      names.push(s.name);
    }
    saveCampaign(names);
    alert(`公式${names.length}面を localStorage に書き出しました。editor.html で読み込んで編集できます。`);
    location.replace("editor.html");
  }
}
