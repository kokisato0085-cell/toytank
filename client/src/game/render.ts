// ステージ・戦車の描画（ワールド座標＝px）。呼び出し側で ctx.scale 済みの状態で使う。

import { TILE } from "../stage/types";
import type { CellPos, StageData } from "../stage/types";
import { BULLET_RADIUS, MINE_ARM, MINE_FUSE, MINE_RADIUS, MINE_WARN, TANK_RADIUS } from "./constants";
import { drawCell, drawStretched, spriteReady, tinted } from "./sprites";

export const COLORS = {
  floor: "#e8e6df",
  steel: "#5a5f6a",
  brick: "#b5723a",
  hole: "#222a36",
  line: "rgba(0,0,0,0.06)",
  p1: "#2d7dd2",
  p2: "#2a8a3e",
  stationary: "#c0392b",
  mover: "#e08020",
  barrel: "#222",
  bulletP: "#1b4e8a", // 自機の弾
  bulletE: "#7a2018", // 敵の弾
  aim: "rgba(45,125,210,0.7)", // 照準線
  explosion: "#ffb020", // 弾相殺の爆発
};

// ワールドサイズ（px）。
export function worldSize(stage: StageData): { w: number; h: number } {
  const { cols, rows, cell } = stage.grid;
  return { w: cols * cell, h: rows * cell };
}

// セル中心のワールド座標。
export function cellCenter(stage: StageData, p: CellPos): { x: number; y: number } {
  const { cell } = stage.grid;
  return { x: (p.col + 0.5) * cell, y: (p.row + 0.5) * cell };
}

// マップを描く。床は全面1枚で継ぎ目なく、壁・穴はマスごと。
export function renderMap(ctx: CanvasRenderingContext2D, stage: StageData): void {
  const { cols, rows, cell } = stage.grid;
  const W = cols * cell;
  const H = rows * cell;

  // 1) ベースを床色で塗る（透過部の黒抜け／前フレーム残像を消す）
  ctx.fillStyle = COLORS.floor;
  ctx.fillRect(0, 0, W, H);
  // 2) 床テクスチャを全面に1枚で敷く（継ぎ目なし）
  const hasFloor = drawStretched(ctx, "floor", 0, 0, W, H);

  // 3) 壁・穴はマスごと（角丸は下の床が透ける）
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = stage.tiles[r][c];
      if (v === TILE.FLOOR) continue;
      const x = c * cell;
      const y = r * cell;
      if (v === TILE.STEEL || v === TILE.BRICK) {
        const nm = v === TILE.STEEL ? "steel" : "brick";
        if (!drawCell(ctx, nm, x, y, cell)) {
          ctx.fillStyle = v === TILE.STEEL ? COLORS.steel : COLORS.brick;
          ctx.fillRect(x, y, cell, cell);
        }
      } else if (v === TILE.HOLE) {
        if (!drawCell(ctx, "hole", x, y, cell)) {
          ctx.fillStyle = COLORS.hole;
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // 4) 床テクスチャが無い（図形フォールバック）ときだけグリッド線
  if (!hasFloor) {
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cell, 0);
      ctx.lineTo(c * cell, H);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * cell);
      ctx.lineTo(W, r * cell);
      ctx.stroke();
    }
  }
}

// 角度θ（0=+X）の向きに画像を描く。画像は「真上(北)向き」前提。
function drawSpriteAngled(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  x: number,
  y: number,
  angle: number,
  size: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2); // 北向き画像を θ へ
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}

// 戦車を1体描く。bodyAngle=車体(移動)の向き、turretAngle=砲塔の向き。
// 画像(tank_body / tank_turret)があれば色で着色して描き、無ければ円＋砲身にフォールバック。
export function drawTank(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  bodyAngle: number,
  turretAngle: number,
  radius = TANK_RADIUS,
): void {
  const body = spriteReady("tank_body") ? tinted("tank_body", color) : null;
  const turret = spriteReady("tank_turret") ? tinted("tank_turret", color) : null;
  if (body && turret) {
    // 機体を当たり判定径より大きめに描く
    const size = radius * 2 * 1.7;
    drawSpriteAngled(ctx, body, x, y, bodyAngle, size);
    drawSpriteAngled(ctx, turret, x, y, turretAngle, size);
    return;
  }
  // フォールバック：円の車体＋砲身（砲塔の向き）
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.barrel;
  ctx.lineWidth = Math.max(5, radius * 0.2);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(turretAngle) * (radius + 8), y + Math.sin(turretAngle) * (radius + 8));
  ctx.stroke();
}

// 弾を描く。進行方向(angle)へ向いた、先端を少しとがらせた細長い長方形。
export function drawBullet(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string): void {
  const half = BULLET_RADIUS * 1.7; // 全長の半分
  const w = BULLET_RADIUS * 0.55; // 半幅
  const tip = BULLET_RADIUS * 0.9; // 先端のとがり長さ
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-half, -w); // 後端・上
  ctx.lineTo(half - tip, -w); // 肩・上
  ctx.lineTo(half, 0); // 先端
  ctx.lineTo(half - tip, w); // 肩・下
  ctx.lineTo(-half, w); // 後端・下
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 爆発エフェクト。progress は 0→1（0で発生、1で消滅）、maxR は最大半径。
export function drawExplosion(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number,
  maxR: number,
  color = COLORS.explosion,
): void {
  ctx.save();
  ctx.globalAlpha = 1 - progress;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, maxR * (0.4 + 0.6 * progress), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 地雷を描く。t は設置からの経過秒。起爆 MINE_WARN 秒前から光＆オーラが点滅する。
export function drawMine(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const armed = t >= MINE_ARM;
  const warning = MINE_FUSE - t <= MINE_WARN;
  const blink = Math.abs(Math.sin(t * 12)); // 0..1 の速い点滅

  // 警告中：膨張・点滅するオーラ
  if (warning) {
    ctx.save();
    ctx.globalAlpha = 0.2 + 0.5 * blink;
    ctx.fillStyle = "#ffd23a";
    ctx.beginPath();
    ctx.arc(x, y, MINE_RADIUS + 6 + blink * 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 本体
  ctx.fillStyle = "#3a3a3a";
  ctx.beginPath();
  ctx.arc(x, y, MINE_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // 中心の光。警告中は赤↔白で点滅、起動後は赤、未起動は灰。
  const center = warning ? (blink > 0.5 ? "#fff2a0" : "#e33") : armed ? "#e33" : "#999";
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(x, y, MINE_RADIUS * 0.4, 0, Math.PI * 2);
  ctx.fill();
}
