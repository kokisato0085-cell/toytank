// ゲーム本体（段階1）。固定タイムステップでシミュレーションを進め、描画は毎フレーム。
// 現ステップ：自機の移動（壁ずり・敵=障害物）＋射撃（右エイムパッド／タップ・即撃ち）、
// 弾の跳弾・命中・フレンドリーファイア、直進の照準線。

import type { EnemyPattern, StageData } from "../stage/types";
import { COLORS, cellCenter, drawBullet, drawExplosion, drawTank, renderMap, worldSize } from "./render";
import { circleHitsSolid, slide } from "./physics";
import { advanceBullet, bulletsCollide, type Bullet } from "./bullet";
import { Input } from "./input";
import {
  BULLET_RADIUS,
  BULLET_SPEED,
  EXPLOSION_LIFE,
  MAX_ACTIVE_BULLETS,
  MAX_BOUNCES,
  SELF_GRACE,
  STEP,
  TANK_RADIUS,
  TANK_SPEED,
} from "./constants";

interface Enemy {
  x: number;
  y: number;
  pattern: EnemyPattern;
}

const HIT_DIST = TANK_RADIUS + BULLET_RADIUS; // 弾と戦車の命中距離

export class Game {
  private ctx: CanvasRenderingContext2D;
  private scale: number;
  private input: Input;
  private spawn: { x: number; y: number };
  private pos: { x: number; y: number };
  private enemies: Enemy[];
  private bullets: Bullet[] = [];
  private explosions: { x: number; y: number; t: number }[] = [];
  private facing = -Math.PI / 2; // 初期は上向き
  private acc = 0;
  private last = 0;

  constructor(canvas: HTMLCanvasElement, private stage: StageData) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D コンテキストを取得できません");
    this.ctx = ctx;

    const { w, h } = worldSize(stage);
    const maxW = Math.min(760, window.innerWidth - 20);
    this.scale = maxW / w;
    canvas.width = Math.round(w * this.scale);
    canvas.height = Math.round(h * this.scale);

    this.input = new Input(canvas);
    this.spawn = cellCenter(stage, stage.players[0]);
    this.pos = { ...this.spawn };
    this.enemies = stage.enemies.map((e) => ({ ...cellCenter(stage, e), pattern: e.pattern }));
  }

  start(): void {
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  private loop = (t: number): void => {
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (dt > 0.25) dt = 0.25;
    this.acc += dt;
    while (this.acc >= STEP) {
      this.update(STEP);
      this.acc -= STEP;
    }
    this.render();
    requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    // 移動（壁＋敵=障害物の軸別スライド）
    const a = this.input.axis();
    if (a.x !== 0 || a.y !== 0) {
      const nx = this.pos.x + a.x * TANK_SPEED * dt;
      const ny = this.pos.y + a.y * TANK_SPEED * dt;
      const blocked = (px: number, py: number): boolean =>
        circleHitsSolid(this.stage, px, py, TANK_RADIUS) || this.hitsEnemy(px, py);
      this.pos = slide(this.pos.x, this.pos.y, nx, ny, blocked);
      this.facing = Math.atan2(a.y, a.x);
    }
    // 照準中は砲塔を照準方向へ
    const ad = this.input.aimDir();
    if (ad) this.facing = Math.atan2(ad.y, ad.x);

    // 発射要求の処理
    for (const f of this.input.takeFires()) {
      if (this.bullets.filter((b) => b.owner === 0).length >= MAX_ACTIVE_BULLETS) break;
      const dir = f.dir ?? { x: Math.cos(this.facing), y: Math.sin(this.facing) };
      this.fire(dir);
    }

    // 弾の更新と命中
    const alive: Bullet[] = [];
    for (const b of this.bullets) {
      if (!advanceBullet(this.stage, b, dt)) continue; // 壁・壊せる壁で消滅
      const ei = this.enemies.findIndex((e) => this.near(b.x, b.y, e.x, e.y));
      if (ei >= 0) {
        this.enemies.splice(ei, 1); // 敵を破壊（FF：弾は所有者を問わず当たる）
        continue;
      }
      // 自機への命中（自爆猶予経過後、または他者の弾）
      if ((b.owner !== 0 || b.age >= SELF_GRACE) && this.near(b.x, b.y, this.pos.x, this.pos.y)) {
        this.respawn();
        return;
      }
      alive.push(b);
    }

    // 弾同士の相殺（敵味方問わず両方消滅＋小爆発）
    const removed = new Set<number>();
    for (let i = 0; i < alive.length; i++) {
      if (removed.has(i)) continue;
      for (let j = i + 1; j < alive.length; j++) {
        if (removed.has(j)) continue;
        if (bulletsCollide(alive[i], alive[j])) {
          removed.add(i);
          removed.add(j);
          this.explosions.push({ x: (alive[i].x + alive[j].x) / 2, y: (alive[i].y + alive[j].y) / 2, t: 0 });
          break;
        }
      }
    }
    this.bullets = alive.filter((_, k) => !removed.has(k));

    // 爆発エフェクトの寿命管理
    for (const ex of this.explosions) ex.t += dt;
    this.explosions = this.explosions.filter((ex) => ex.t < EXPLOSION_LIFE);
  }

  private fire(dir: { x: number; y: number }): void {
    const sx = this.pos.x + dir.x * (TANK_RADIUS + BULLET_RADIUS + 2);
    const sy = this.pos.y + dir.y * (TANK_RADIUS + BULLET_RADIUS + 2);
    this.bullets.push({
      x: sx,
      y: sy,
      vx: dir.x * BULLET_SPEED,
      vy: dir.y * BULLET_SPEED,
      bounces: MAX_BOUNCES,
      owner: 0,
      age: 0,
    });
    this.facing = Math.atan2(dir.y, dir.x);
  }

  private respawn(): void {
    this.pos = { ...this.spawn };
    this.bullets = [];
  }

  private hitsEnemy(px: number, py: number): boolean {
    const minDist = TANK_RADIUS * 2;
    for (const e of this.enemies) {
      const dx = px - e.x;
      const dy = py - e.y;
      if (dx * dx + dy * dy < minDist * minDist) return true;
    }
    return false;
  }

  private near(ax: number, ay: number, bx: number, by: number): boolean {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy < HIT_DIST * HIT_DIST;
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    renderMap(ctx, this.stage);
    for (const e of this.enemies) {
      drawTank(ctx, e.x, e.y, e.pattern === "stationary" ? COLORS.stationary : COLORS.mover, Math.PI / 2);
    }
    this.drawAimLine(ctx);
    drawTank(ctx, this.pos.x, this.pos.y, COLORS.p1, this.facing);
    for (const b of this.bullets) {
      drawBullet(ctx, b.x, b.y, Math.atan2(b.vy, b.vx), b.owner === 0 ? COLORS.bulletP : COLORS.bulletE);
    }
    for (const ex of this.explosions) drawExplosion(ctx, ex.x, ex.y, ex.t / EXPLOSION_LIFE);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.input.drawSticks(ctx);
  }

  // 直進の照準線（反射は描かない）。最初の壁／場外／敵に当たる位置まで。
  private drawAimLine(ctx: CanvasRenderingContext2D): void {
    const d = this.input.aimDir();
    if (!d) return;
    const STEP_LEN = 6;
    const MAX_LEN = 900;
    let ex = this.pos.x;
    let ey = this.pos.y;
    for (let t = TANK_RADIUS; t <= MAX_LEN; t += STEP_LEN) {
      const px = this.pos.x + d.x * t;
      const py = this.pos.y + d.y * t;
      ex = px;
      ey = py;
      if (circleHitsSolid(this.stage, px, py, 2)) break;
      if (this.enemies.some((e) => this.near(px, py, e.x, e.y))) break;
    }
    ctx.strokeStyle = COLORS.aim;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(this.pos.x, this.pos.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
