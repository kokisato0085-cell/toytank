// ステージ・戦車の描画（ワールド座標＝px）。呼び出し側で ctx.scale 済みの状態で使う。

import { TILE } from "../stage/types";
import type { CellPos, StageData } from "../stage/types";
import { TANK_RADIUS } from "./constants";

export const COLORS = {
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

// マップ（タイル＋グリッド線）を描く。
export function renderMap(ctx: CanvasRenderingContext2D, stage: StageData): void {
  const { cols, rows, cell } = stage.grid;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = stage.tiles[r][c];
      ctx.fillStyle = v === TILE.STEEL ? COLORS.steel : v === TILE.BRICK ? COLORS.brick : COLORS.floor;
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }
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
}

// 戦車を1体描く（円の車体＋砲塔）。angle は砲塔の向き（ラジアン）。
export function drawTank(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, angle: number): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, TANK_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.barrel;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle) * (TANK_RADIUS + 8), y + Math.sin(angle) * (TANK_RADIUS + 8));
  ctx.stroke();
}
