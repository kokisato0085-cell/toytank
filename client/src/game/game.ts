// ゲーム本体（段階1）。固定タイムステップでシミュレーションを進め、描画は毎フレーム。
// 現ステップ：自機の移動（壁ずり・敵=障害物）＋射撃（右エイムパッド／タップ・即撃ち）、
// 弾の跳弾・命中・フレンドリーファイア、直進の照準線。

import { TILE } from "../stage/types";
import type { EnemyPattern, StageData } from "../stage/types";
import { COLORS, cellCenter, drawBullet, drawExplosion, drawMine, drawTank, renderMap, worldSize } from "./render";
import { circleHitsSolid, slide } from "./physics";
import { advanceBullet, bulletsCollide, type Bullet } from "./bullet";
import { blastReaches, computeAimDir } from "./ai";
import { Input } from "./input";
import {
  BULLET_RADIUS,
  BULLET_SPEED,
  ENEMY_COOLDOWN,
  EXPLOSION_LIFE,
  MAX_ACTIVE_BULLETS,
  MAX_BOUNCES,
  MAX_MINES,
  MINE_BLAST_CELLS,
  MINE_BLAST_LIFE,
  MINE_FUSE,
  MINE_RADIUS,
  MOVER_SPEED,
  SELF_GRACE,
  STEP,
  TANK_RADIUS,
  TANK_SPEED,
} from "./constants";

interface Enemy {
  x: number;
  y: number;
  pattern: EnemyPattern;
  cd: number; // 発射クールダウン残り(秒)
  facing: number; // 砲塔の向き
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
  private mines: { x: number; y: number; t: number }[] = [];
  private explosions: { x: number; y: number; t: number; maxR: number; life: number }[] = [];
  private blastR: number;
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
    this.enemies = stage.enemies.map((e) => ({ ...cellCenter(stage, e), pattern: e.pattern, cd: 0, facing: Math.PI / 2 }));
    this.blastR = MINE_BLAST_CELLS * stage.grid.cell;
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

    // 敵AI（移動＋射撃）
    this.updateEnemies(dt);

    // 弾の更新と命中
    const alive: Bullet[] = [];
    const mineHits: number[] = []; // 弾が当たった地雷（即起爆）
    for (const b of this.bullets) {
      if (!advanceBullet(this.stage, b, dt)) continue; // 壁で反射しきって消滅
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
      // 地雷への命中 → その地雷を即起爆（弾は消費）
      const mi = this.mines.findIndex((m) => this.dist(b.x, b.y, m.x, m.y) < MINE_RADIUS + BULLET_RADIUS);
      if (mi >= 0) {
        mineHits.push(mi);
        continue;
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
          this.explosions.push({
            x: (alive[i].x + alive[j].x) / 2,
            y: (alive[i].y + alive[j].y) / 2,
            t: 0,
            maxR: BULLET_RADIUS * 2,
            life: EXPLOSION_LIFE,
          });
          break;
        }
      }
    }
    this.bullets = alive.filter((_, k) => !removed.has(k));

    // 弾が当たった地雷を即起爆（連鎖含む）
    if (mineHits.length) this.detonate(mineHits);

    // 地雷（設置要求の処理＋信管起爆）
    for (let n = this.input.takeMines(); n > 0; n--) this.layMine();
    this.updateMines(dt);

    // 爆発エフェクトの寿命管理
    for (const ex of this.explosions) ex.t += dt;
    this.explosions = this.explosions.filter((ex) => ex.t < ex.life);
  }

  // 地雷を設置（最大 MAX_MINES）。外部ボタンからも呼べる。
  layMine(): void {
    if (this.mines.length >= MAX_MINES) return;
    this.mines.push({ x: this.pos.x, y: this.pos.y, t: 0 });
  }

  private updateMines(dt: number): void {
    const triggered: number[] = [];
    this.mines.forEach((m, i) => {
      m.t += dt;
      if (m.t >= MINE_FUSE) triggered.push(i); // 信管満了で起爆（近接起爆は廃止・弾命中は別経路）
    });
    if (triggered.length) this.detonate(triggered);
  }

  // 起爆（誘爆の連鎖を含む）。範囲内の戦車を破壊・壊せる壁を破壊。
  private detonate(seed: number[]): void {
    const det = new Set<number>(seed);
    const queue = [...seed];
    let playerHit = false;
    while (queue.length) {
      const m = this.mines[queue.pop()!];
      this.explosions.push({ x: m.x, y: m.y, t: 0, maxR: this.blastR, life: MINE_BLAST_LIFE });
      this.destroyBricksNear(m.x, m.y, this.blastR);
      if (this.inBlast(m.x, m.y, this.pos.x, this.pos.y)) playerHit = true;
      this.enemies = this.enemies.filter((e) => !this.inBlast(m.x, m.y, e.x, e.y));
      this.mines.forEach((o, j) => {
        if (!det.has(j) && this.inBlast(m.x, m.y, o.x, o.y)) {
          det.add(j);
          queue.push(j);
        }
      });
    }
    this.mines = this.mines.filter((_, j) => !det.has(j));
    if (playerHit) this.respawn();
  }

  // 爆心(mx,my)から(tx,ty)が爆風範囲内かつ壁に遮られていないか。
  private inBlast(mx: number, my: number, tx: number, ty: number): boolean {
    return this.dist(mx, my, tx, ty) < this.blastR && blastReaches(this.stage, mx, my, tx, ty);
  }

  private destroyBricksNear(x: number, y: number, r: number): void {
    const { cols, rows, cell } = this.stage.grid;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (this.stage.tiles[row][col] !== TILE.BRICK) continue;
        const cx = (col + 0.5) * cell;
        const cy = (row + 0.5) * cell;
        if (this.dist(x, y, cx, cy) < r && blastReaches(this.stage, x, y, cx, cy)) {
          this.stage.tiles[row][col] = TILE.FLOOR;
        }
      }
    }
  }

  private dist(ax: number, ay: number, bx: number, by: number): number {
    return Math.hypot(ax - bx, ay - by);
  }

  private fire(dir: { x: number; y: number }): void {
    this.spawnBullet(this.pos.x, this.pos.y, dir, 0);
    this.facing = Math.atan2(dir.y, dir.x);
  }

  // owner: 0=自機, 1=敵。砲口（半径の外側）から発射する。
  private spawnBullet(ox: number, oy: number, dir: { x: number; y: number }, owner: number): void {
    const off = TANK_RADIUS + BULLET_RADIUS + 2;
    this.bullets.push({
      x: ox + dir.x * off,
      y: oy + dir.y * off,
      vx: dir.x * BULLET_SPEED,
      vy: dir.y * BULLET_SPEED,
      bounces: MAX_BOUNCES,
      owner,
      age: 0,
    });
  }

  // 敵の移動（移動型は自機へ接近）と射撃（直射／バンクショット）。
  private updateEnemies(dt: number): void {
    for (const e of this.enemies) {
      if (e.pattern === "mover") {
        const dx = this.pos.x - e.x;
        const dy = this.pos.y - e.y;
        const m = Math.hypot(dx, dy) || 1;
        const nx = e.x + (dx / m) * MOVER_SPEED * dt;
        const ny = e.y + (dy / m) * MOVER_SPEED * dt;
        const res = slide(e.x, e.y, nx, ny, (px, py) => circleHitsSolid(this.stage, px, py, TANK_RADIUS));
        e.x = res.x;
        e.y = res.y;
        e.facing = Math.atan2(dy, dx);
      }
      e.cd -= dt;
      if (e.cd <= 0) {
        const dir = computeAimDir(this.stage, e.x, e.y, this.pos.x, this.pos.y);
        if (dir) {
          this.spawnBullet(e.x, e.y, dir, 1);
          e.facing = Math.atan2(dir.y, dir.x);
          e.cd = ENEMY_COOLDOWN;
        } else {
          e.cd = 0.3; // 射線が無いときは少し待って再試行
        }
      }
    }
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
    for (const m of this.mines) drawMine(ctx, m.x, m.y, m.t);
    for (const e of this.enemies) {
      drawTank(ctx, e.x, e.y, e.pattern === "stationary" ? COLORS.stationary : COLORS.mover, e.facing);
    }
    this.drawAimLine(ctx);
    drawTank(ctx, this.pos.x, this.pos.y, COLORS.p1, this.facing);
    for (const b of this.bullets) {
      drawBullet(ctx, b.x, b.y, Math.atan2(b.vy, b.vx), b.owner === 0 ? COLORS.bulletP : COLORS.bulletE);
    }
    for (const ex of this.explosions) drawExplosion(ctx, ex.x, ex.y, ex.t / ex.life, ex.maxR);

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
