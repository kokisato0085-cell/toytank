// 効果音（SE）。Web Audio API で /audio/<名前>.mp3 を再生する。
// ファイルが無ければ無音でフォールバック。連続音はスロットルで間引く。
// スマホの自動再生制約に対応するため、最初のユーザー操作で unlock() を呼ぶこと。

const NAMES = ["shot", "bounce", "mine", "explosion", "miss", "clear", "gameover", "engine", "bgm"] as const;
export type SoundName = (typeof NAMES)[number];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const raw: Record<string, ArrayBuffer> = {}; // デコード前のバイト列
const buffers: Record<string, AudioBuffer> = {}; // デコード済み
const headSilence: Record<string, number> = {}; // 検出した先頭無音の秒数（自動スキップ）
const lastPlay: Record<string, number> = {}; // スロットル用（最終再生時刻 ms）

const MUTE_KEY = "toytank.muted";
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();

// 全体音量（0..1）。クリッピング回避の基準値に掛けて master ゲインへ反映する。
const VOL_KEY = "toytank.volume";
const MASTER_BASE = 0.7; // volume=1 のときの master ゲイン
let volume = (() => {
  try {
    const v = parseFloat(localStorage.getItem(VOL_KEY) ?? "");
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  } catch {
    return 1;
  }
})();

// 各SEのバイト列を先読み（デコードは AudioContext 生成後）。
for (const name of NAMES) {
  fetch(`${import.meta.env.BASE_URL}audio/${name}.mp3`) // base(/toytank/等)込みで解決
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("404"))))
    .then((buf) => {
      raw[name] = buf;
      decodeOne(name); // すでに ctx があればデコード
    })
    .catch(() => {
      /* 無ければ無音 */
    });
}

// 先頭の無音（しきい値以下が続く区間）の秒数を返す。鳴り出しを自動で早める用。
function detectHeadSilence(b: AudioBuffer): number {
  const thr = 0.012; // これ以下は無音とみなす
  const ch = b.getChannelData(0);
  let i = 0;
  while (i < ch.length && Math.abs(ch[i]) <= thr) i++;
  if (i >= ch.length) return 0; // 全部無音なら飛ばさない
  const back = Math.floor(b.sampleRate * 0.004); // 立ち上がりを欠かさないよう少し手前から
  return Math.max(0, i - back) / b.sampleRate;
}

function decodeOne(name: string): void {
  if (!ctx || buffers[name] || !raw[name]) return;
  // decodeAudioData は ArrayBuffer を消費するためコピーを渡す
  ctx.decodeAudioData(raw[name].slice(0)).then(
    (b) => {
      buffers[name] = b;
      headSilence[name] = detectHeadSilence(b); // 先頭無音を検出して以後自動スキップ
      if (name === "bgm") tryStartBgm(); // BGMはデコード完了時に（要求があれば）再生開始
    },
    () => {
      /* デコード失敗＝無音 */
    },
  );
}

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = MASTER_BASE * volume;
  master.connect(ctx.destination);
  for (const name of NAMES) decodeOne(name); // 先読み済みのものをデコード
  return ctx;
}

// 最初のユーザー操作で呼ぶ（iOS等の自動再生解除）。
export function unlockSound(): void {
  const c = ensureCtx();
  if (c && c.state === "suspended") void c.resume();
  tryStartBgm(); // 解除済みで再生待ちのBGMがあれば開始
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  try {
    localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  } catch {
    /* 無視 */
  }
  for (const name of Object.keys(loops)) applyLoopGain(name); // ループ音もミュート連動
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

// 全体音量（0..1）の取得・設定。設定値は localStorage に保存し、master ゲインへ即反映。
export function getVolume(): number {
  return volume;
}

export function setVolume(v: number): void {
  volume = Math.min(1, Math.max(0, v));
  try {
    localStorage.setItem(VOL_KEY, String(volume));
  } catch {
    /* 無視 */
  }
  if (ctx && master) {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(MASTER_BASE * volume, t + 0.05); // プチノイズ防止に短くフェード
  }
}

// ループ再生（走行音など、動いている間ずっと鳴らす用）。
// プチノイズ防止のため start/stop ではなく音量フェードで ON/OFF する。
const loops: Record<string, { src: AudioBufferSourceNode; gain: GainNode; on: boolean; vol: number }> = {};

// ミュート・ON状態に応じてループ音量を目標値へフェード。
function applyLoopGain(name: string): void {
  const node = loops[name];
  if (!ctx || !node) return;
  const target = node.on && !muted ? node.vol : 0;
  const t = ctx.currentTime;
  node.gain.gain.cancelScheduledValues(t);
  node.gain.gain.setValueAtTime(node.gain.gain.value, t);
  node.gain.gain.linearRampToValueAtTime(target, t + 0.08);
}

// ループ音の ON/OFF を設定する。on=動いている間 true。volume=音量(0..1)。
export function setLoop(name: SoundName, on: boolean, volume = 0.4): void {
  if (!ctx || !master) return;
  const buf = buffers[name];
  if (!buf) return;
  let node = loops[name];
  if (!node) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = headSilence[name] ?? 0; // 先頭無音はループ対象から外す
    src.loopEnd = buf.duration;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g);
    g.connect(master);
    src.start(0, headSilence[name] ?? 0);
    node = loops[name] = { src, gain: g, on: false, vol: volume };
  }
  node.vol = volume;
  if (node.on !== on) {
    node.on = on;
    applyLoopGain(name);
  }
}

// BGM：頭出しで再生開始（再生中なら作り直して最初から）。停止はフェードアウト。
// デコード未完了・未解除でも要求を覚えておき、準備でき次第 tryStartBgm が開始する。
let bgmWanted = false;
let bgmVol = 0.2;

function tryStartBgm(): void {
  if (!bgmWanted || !ctx || !master || !buffers["bgm"]) return;
  const ex = loops["bgm"];
  if (ex) {
    try {
      ex.src.stop();
    } catch {
      /* 既に停止済み */
    }
    delete loops["bgm"];
  }
  setLoop("bgm", true, bgmVol); // 先頭（先頭無音スキップ位置）から新規再生
}

export function startBgm(volume = 0.2): void {
  bgmWanted = true;
  bgmVol = volume;
  tryStartBgm();
}

export function stopBgm(): void {
  bgmWanted = false;
  const node = loops["bgm"];
  if (!node) return;
  node.on = false;
  applyLoopGain("bgm"); // フェードアウト（ソースは無音で待機）
}

// SEを鳴らす。
//  volume=音量(0..1)、throttleMs=直近同名SEからこの時間内なら鳴らさない、
//  offsetSec=クリップ先頭をこの秒数だけ飛ばして再生（頭の無音対策＝発生を早く）、
//  durationSec=この秒数で打ち切り（短く鳴らす。末尾は軽くフェードしてプチノイズ防止）。
export function playSound(
  name: SoundName,
  opts: { volume?: number; throttleMs?: number; offsetSec?: number; durationSec?: number } = {},
): void {
  if (muted || !ctx || !master) return;
  const buf = buffers[name];
  if (!buf) return;
  const now = performance.now();
  const gap = opts.throttleMs ?? 0;
  if (gap > 0 && now - (lastPlay[name] ?? -1e9) < gap) return;
  lastPlay[name] = now;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  const vol = opts.volume ?? 1;
  g.gain.value = vol;
  src.connect(g);
  g.connect(master);
  // 先頭無音の自動スキップ ＋ 明示の offsetSec を加味
  const offset = Math.min(Math.max((headSilence[name] ?? 0) + (opts.offsetSec ?? 0), 0), buf.duration);
  if (opts.durationSec && opts.durationSec > 0) {
    const dur = Math.min(opts.durationSec, buf.duration - offset);
    const t0 = ctx.currentTime;
    const fade = Math.min(0.02, dur * 0.3);
    g.gain.setValueAtTime(vol, t0 + Math.max(0, dur - fade));
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    src.start(0, offset, dur);
  } else {
    src.start(0, offset);
  }
}
