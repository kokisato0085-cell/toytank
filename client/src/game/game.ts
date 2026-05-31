// ゲーム本体（段階1）。固定タイムステップでシミュレーションを進め、描画は毎フレーム。
// 現ステップ：自機（P1）を左スティック／キーボードで動かし、壁ずりで衝突解決する。

import type { StageData } from "../stage/types";
import { COLORS, cellCenter, drawTank, renderMap, worldSize } from "./render";
import { circleHitsSolid, slide } from "./physics";
import { Input } from "./input";
import { STEP, TANK_RADIUS, TANK_SPEED } from "./constants";

export class Game {
  private ctx: CanvasRenderingContext2D;
  private scale: number;
  private input: Input;
  private pos: { x: number; y: number };
  private enemyCenters: { x: number; y: number }[];
  private facing = -Math.PI / 2; // 初期は上向き
  private acc = 0;
  private last = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private stage: StageData,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D コンテキストを取得できません");
    this.ctx = ctx;

    // 画面幅に合わせて等倍率で表示する。
    const { w, h } = worldSize(stage);
    const maxW = Math.min(760, window.innerWidth - 20);
    this.scale = maxW / w;
    canvas.width = Math.round(w * this.scale);
    canvas.height = Math.round(h * this.scale);

    this.input = new Input(canvas);
    this.pos = cellCenter(stage, stage.players[0]);
    this.enemyCenters = stage.enemies.map((e) => cellCenter(stage, e));
  }

  // 敵を半径 TANK_RADIUS の障害物として扱い、中心(px,py)が重なるか。
  private hitsEnemy(px: number, py: number): boolean {
    const minDist = TANK_RADIUS * 2;
    for (const c of this.enemyCenters) {
      const dx = px - c.x;
      const dy = py - c.y;
      if (dx * dx + dy * dy < minDist * minDist) return true;
    }
    return false;
  }

  start(): void {
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  private loop = (t: number): void => {
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (dt > 0.25) dt = 0.25; // タブ復帰時の暴走防止
    this.acc += dt;
    while (this.acc >= STEP) {
      this.update(STEP);
      this.acc -= STEP;
    }
    this.render();
    requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    const a = this.input.axis();
    if (a.x !== 0 || a.y !== 0) {
      const nx = this.pos.x + a.x * TANK_SPEED * dt;
      const ny = this.pos.y + a.y * TANK_SPEED * dt;
      // 壁（ソリッドセル・場外）と敵（障害物扱い）の両方で塞ぐ。
      const blocked = (px: number, py: number): boolean =>
        circleHitsSolid(this.stage, px, py, TANK_RADIUS) || this.hitsEnemy(px, py);
      this.pos = slide(this.pos.x, this.pos.y, nx, ny, blocked);
      this.facing = Math.atan2(a.y, a.x);
    }
  }

  private render(): void {
    const ctx = this.ctx;
    // ワールド（拡大して描画）
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    renderMap(ctx, this.stage);
    // 敵（この段階では静止表示）
    for (const e of this.stage.enemies) {
      const c = cellCenter(this.stage, e);
      drawTank(ctx, c.x, c.y, e.pattern === "stationary" ? COLORS.stationary : COLORS.mover, Math.PI / 2);
    }
    // 自機
    drawTank(ctx, this.pos.x, this.pos.y, COLORS.p1, this.facing);
    // スティックUI（デバイス座標で重ねる）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.input.drawStick(ctx);
  }
}
