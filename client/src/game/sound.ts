// 効果音（SE）。Web Audio API で /audio/<名前>.mp3 を再生する。
// ファイルが無ければ無音でフォールバック。連続音はスロットルで間引く。
// スマホの自動再生制約に対応するため、最初のユーザー操作で unlock() を呼ぶこと。

const NAMES = ["shot", "bounce", "mine", "explosion", "miss", "clear", "gameover"] as const;
export type SoundName = (typeof NAMES)[number];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const raw: Record<string, ArrayBuffer> = {}; // デコード前のバイト列
const buffers: Record<string, AudioBuffer> = {}; // デコード済み
const lastPlay: Record<string, number> = {}; // スロットル用（最終再生時刻 ms）

const MUTE_KEY = "toytank.muted";
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();

// 各SEのバイト列を先読み（デコードは AudioContext 生成後）。
for (const name of NAMES) {
  fetch(`/audio/${name}.mp3`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("404"))))
    .then((buf) => {
      raw[name] = buf;
      decodeOne(name); // すでに ctx があればデコード
    })
    .catch(() => {
      /* 無ければ無音 */
    });
}

function decodeOne(name: string): void {
  if (!ctx || buffers[name] || !raw[name]) return;
  // decodeAudioData は ArrayBuffer を消費するためコピーを渡す
  ctx.decodeAudioData(raw[name].slice(0)).then(
    (b) => {
      buffers[name] = b;
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
  master.gain.value = 0.7;
  master.connect(ctx.destination);
  for (const name of NAMES) decodeOne(name); // 先読み済みのものをデコード
  return ctx;
}

// 最初のユーザー操作で呼ぶ（iOS等の自動再生解除）。
export function unlockSound(): void {
  const c = ensureCtx();
  if (c && c.state === "suspended") void c.resume();
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
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

// SEを鳴らす。volume=音量(0..1)、throttleMs=直近同名SEからこの時間内なら鳴らさない。
export function playSound(name: SoundName, opts: { volume?: number; throttleMs?: number } = {}): void {
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
  g.gain.value = opts.volume ?? 1;
  src.connect(g);
  g.connect(master);
  src.start();
}
