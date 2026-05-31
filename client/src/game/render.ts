// ステージの描画（ワールド座標＝px で描く）。
// 呼び出し側でキャンバスサイズと拡大率を設定し、ctx.scale 済みの状態で呼ぶ。
// 段階1の最初のステップ：静止状態のマップ・戦車・敵を可視化する。

import { TILE } from "../stage/types";
import type { CellPos, StageData } from "../stage/types";

const COLORS = {
  floor: "#e8e6df",
  steel: "#5a5f6a",
  brick: "#b5723a",
  line: "rgba(0,0,0,0.06)",
  p1: "#2d7dd2",
  p2: "#2a8a3e",
  stationary: "#c0392b",
  mover: "#e08020",
  barrel: "#222",
};

const TANK_RADIUS = 24; // BasicDesign §13

// ワールドサイズ（px）。
export function worldSize(stage: StageData): { w: number; h: number } {
  const { cols, rows, cell } = stage.grid;
  return { w: cols * cell, h: rows * cell };
}

// セル中心のワールド座標。
function center(stage: StageData, p: CellPos): { x: number; y: number } {
  const { cell } = stage.grid;
  return { x: (p.col + 0.5) * cell, y: (p.row + 0.5) * cell };
}

export function renderStage(ctx: CanvasRenderingContext2D, stage: StageData): void {
  const { cols, rows, cell } = stage.grid;

  // タイル
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = stage.tiles[r][c];
      ctx.fillStyle = v === TILE.STEEL ? COLORS.steel : v === TILE.BRICK ? COLORS.brick : COLORS.floor;
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }

  // 薄いグリッド線
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * cell, 0);
    ctx.lineTo(c * cell, rows * cell);
    ctx.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * cell);
    ctx.lineTo(cols * cell, r * cell);
    ctx.stroke();
  }

  // 戦車（プレイヤー）。砲塔は上向きで仮表示。
  stage.players.forEach((p, i) => drawTank(ctx, center(stage, p), i === 0 ? COLORS.p1 : COLORS.p2, -Math.PI / 2));
  // 敵。砲塔は下向きで仮表示。
  for (const e of stage.enemies) {
    drawTank(ctx, center(stage, e), e.pattern === "stationary" ? COLORS.stationary : COLORS.mover, Math.PI / 2);
  }
}

// 戦車を1体描く（円の車体＋砲塔）。
function drawTank(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }, color: string, angle: number): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, TANK_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  // 砲塔
  ctx.strokeStyle = COLORS.barrel;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  ctx.lineTo(pos.x + Math.cos(angle) * (TANK_RADIUS + 8), pos.y + Math.sin(angle) * (TANK_RADIUS + 8));
  ctx.stroke();
}
