// スプライト（画像）の読み込みと、タイプ色での着色。
// /sprites/<名前>.png を読み込み、無ければ ready=false のまま（描画側は図形にフォールバック）。

const NAMES = ["floor", "steel", "brick", "hole", "tank_body", "tank_turret"] as const;
export type SpriteName = (typeof NAMES)[number];

const imgs: Record<string, HTMLImageElement> = {};
const ready: Record<string, boolean> = {};

for (const name of NAMES) {
  const img = new Image();
  ready[name] = false;
  img.onload = () => {
    ready[name] = true;
  };
  img.onerror = () => {
    ready[name] = false;
  };
  img.src = `/sprites/${name}.png`;
  imgs[name] = img;
}

export function spriteReady(name: SpriteName): boolean {
  return ready[name];
}

export function sprite(name: SpriteName): HTMLImageElement {
  return imgs[name];
}

const BASE = 160; // 着色用の作業解像度（元は巨大なので縮小して処理）
const ALPHA_CUTOFF = 60; // これ未満のアルファは完全透明に（透過部分の色漏れ防止）

const baseData = new Map<string, ImageData>();
const tintCache = new Map<string, HTMLCanvasElement>();

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 縮小＋アルファ整形した「素地」を作る（薄いアルファは透明に）。
function buildBase(name: SpriteName): ImageData | null {
  const img = imgs[name];
  const c = document.createElement("canvas");
  c.width = BASE;
  c.height = BASE;
  const cx = c.getContext("2d");
  if (!cx) return null;
  cx.drawImage(img, 0, 0, BASE, BASE);
  const d = cx.getImageData(0, 0, BASE, BASE);
  const a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const r = a[i];
    const g = a[i + 1];
    const b = a[i + 2];
    // 薄いアルファ＝透明化。緑が突出したピクセル＝背景除去の緑フチ→透明化（戦車は白系）
    if (a[i + 3] < ALPHA_CUTOFF || (g > r + 28 && g > b + 28)) a[i + 3] = 0;
  }
  baseData.set(name, d);
  return d;
}

// シルエットを指定色で着色（陰影を保つ乗算＋透明部は透明のまま）。未ロードなら null。
export function tinted(name: SpriteName, color: string): HTMLCanvasElement | null {
  if (!ready[name]) return null;
  const key = `${name}|${color}`;
  const cached = tintCache.get(key);
  if (cached) return cached;
  const base = baseData.get(name) ?? buildBase(name);
  if (!base) return null;
  const c = document.createElement("canvas");
  c.width = BASE;
  c.height = BASE;
  const cx = c.getContext("2d");
  if (!cx) return null;
  const out = cx.createImageData(BASE, BASE);
  const o = out.data;
  const b = base.data;
  const [cr, cg, cb] = hexRgb(color);
  for (let i = 0; i < o.length; i += 4) {
    o[i] = (b[i] * cr) / 255;
    o[i + 1] = (b[i + 1] * cg) / 255;
    o[i + 2] = (b[i + 2] * cb) / 255;
    o[i + 3] = b[i + 3];
  }
  cx.putImageData(out, 0, 0);
  tintCache.set(key, c);
  return c;
}
