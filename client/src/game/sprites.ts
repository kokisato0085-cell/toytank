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

// 画像の不透明部分のバウンディングボックス（余白を除いた実体）。一度だけ計算してキャッシュ。
const boxCache = new Map<string, { sx: number; sy: number; sw: number; sh: number }>();
function spriteBox(name: SpriteName): { sx: number; sy: number; sw: number; sh: number } {
  const c = boxCache.get(name);
  if (c) return c;
  const img = imgs[name];
  const w = img.naturalWidth || 1;
  const h = img.naturalHeight || 1;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext("2d");
  let box = { sx: 0, sy: 0, sw: w, sh: h };
  if (cx) {
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, w, h).data;
    let minx = w;
    let miny = h;
    let maxx = -1;
    let maxy = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 30) {
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
        }
      }
    }
    if (maxx >= 0) box = { sx: minx, sy: miny, sw: maxx - minx + 1, sh: maxy - miny + 1 };
  }
  boxCache.set(name, box);
  return box;
}

// タイルを1マスに敷く（余白を切り出してセルにフィット）。描けたら true。
export function drawCell(ctx: CanvasRenderingContext2D, name: SpriteName, x: number, y: number, cell: number): boolean {
  if (!ready[name]) return false;
  const b = spriteBox(name);
  ctx.drawImage(imgs[name], b.sx, b.sy, b.sw, b.sh, x, y, cell, cell);
  return true;
}

// 不透明部分を任意の矩形へ引き伸ばして敷く（床を全面1枚＝継ぎ目なしに使う）。描けたら true。
export function drawStretched(
  ctx: CanvasRenderingContext2D,
  name: SpriteName,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): boolean {
  if (!ready[name]) return false;
  const b = spriteBox(name);
  ctx.drawImage(imgs[name], b.sx, b.sy, b.sw, b.sh, dx, dy, dw, dh);
  return true;
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
