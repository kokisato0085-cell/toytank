// ゲーム本体（段階1）。固定タイムステップでシミュレーションを進め、描画は毎フレーム。
// 現ステップ：自機の移動（壁ずり・敵=障害物）＋射撃（右エイムパッド／タップ・即撃ち）、
// 弾の跳弾・命中・フレンドリーファイア、直進の照準線。

import { TILE } from "../stage/types";
import type { EnemyPattern, StageData, TileValue } from "../stage/types";
import { COLORS, cellCenter, drawBullet, drawExplosion, drawMine, drawTank, renderMap, worldSize } from "./render";
import { circleHitsSolid, slide } from "./physics";
import { advanceBullet, bulletsCollide, type Bullet } from "./bullet";
import { blastReaches, computeAimDir } from "./ai";
import { Input } from "./input";
import {
  BULLET_RADIUS,
  BULLET_SPEED,
  ENEMY_AIM_JITTER,
  ENEMY_COOLDOWN_MOVER,
  ENEMY_COOLDOWN_STATIONARY,
  EXPLOSION_LIFE,
  MAX_ACTIVE_BULLETS,
  MAX_BOUNCES,
  MAX_MINES,
  MINE_BLAST_CELLS,
  MINE_BLAST_LIFE,
  MINE_FUSE,
  MINE_RADIUS,
  INTRO_PAUSE,
  MOVER_SPEED,
  RESPAWN_PAUSE,
  SELF_GRACE,
  SOLO_LIVES,
  STEP,
  TANK_RADIUS,
  TANK_SPEED,
} from "./constants";

type GameState = "intro" | "playing" | "respawning" | "cleared" | "gameover";

interface Enemy {
  x: number;
  y: number;
  hx: number; // 初期位置（リスポーン時に戻す）
  hy: number;
  pattern: EnemyPattern;
  cd: number; // 発射クールダウン残り(秒)
  facing: number; // 砲塔の向き
}

const HIT_DIST = TANK_RADIUS + BULLET_RADIUS; // 弾と戦車の命中距離

// ベクトルを角度 ang(rad) 回転する。
function rotate(v: { x: number; y: number }, ang: number): { x: number; y: number } {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

// HUD/区切り画面用の小さな戦車アイコン（デバイス座標）。砲塔は上向き。
function drawTankIcon(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 14);
  ctx.stroke();
}

// ステージ定義から敵エンティティを生成（初期位置 hx/hy も保持）。
function makeEnemies(stage: StageData): Enemy[] {
  return stage.enemies.map((e) => {
    const c = cellCenter(stage, e);
    return { x: c.x, y: c.y, hx: c.x, hy: c.y, pattern: e.pattern, cd: 0, facing: Math.PI / 2 };
  });
}

export class Game {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
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
  private lives = SOLO_LIVES;
  private state: GameState = "playing";
  private interTimer = 0; // 区切りポーズ／開始画面の残り秒
  private stageLabel = ""; // 「ステージN」表示用
  private kills: Record<EnemyPattern, number> = { stationary: 0, mover: 0 }; // 種類別の撃破数（リザルト用）
  private initialTiles: TileValue[][]; // 壊せる壁の復元用

  // 進行制御のコールバック（キャンペーン用）。クリア／ゲームオーバー遷移時に1回呼ぶ。
  onStageClear: (() => void) | null = null;
  onGameOver: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private stage: StageData) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D コンテキストを取得できません");
    this.ctx = ctx;
    this.fit();
    this.input = new Input(canvas);
    this.spawn = cellCenter(stage, stage.players[0]);
    this.pos = { ...this.spawn };
    this.enemies = makeEnemies(stage);
    this.blastR = MINE_BLAST_CELLS * stage.grid.cell;
    this.initialTiles = stage.tiles.map((row) => [...row]);
  }

  // 画面幅に合わせてキャンバスサイズと拡大率を設定（ステージごとにサイズが違ってもよい）。
  private fit(): void {
    const { w, h } = worldSize(this.stage);
    const maxW = Math.min(760, window.innerWidth - 20);
    this.scale = maxW / w;
    this.canvas.width = Math.round(w * this.scale);
    this.canvas.height = Math.round(h * this.scale);
  }

  // 別ステージを読み込む（キャンペーンの次ステージ等）。resetLives で残機を初期化するか選ぶ。
  loadStage(stage: StageData, resetLives: boolean): void {
    this.stage = stage;
    this.spawn = cellCenter(stage, stage.players[0]);
    this.blastR = MINE_BLAST_CELLS * stage.grid.cell;
    this.initialTiles = stage.tiles.map((row) => [...row]);
    this.fit();
    if (resetLives) {
      this.lives = SOLO_LIVES;
      this.kills = { stationary: 0, mover: 0 }; // 新しいランの開始
    }
    this.resetStage();
    this.state = "playing";
  }

  // ステージ開始の区切り画面を表示する（キャンペーンで各ステージ開始時に呼ぶ）。
  beginStage(label: string): void {
    this.stageLabel = label;
    this.state = "intro";
    this.interTimer = INTRO_PAUSE;
  }

  start(): void {
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  private loop = (t: number): void => {
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (dt > 0.25) dt = 0.25;

    // 区切り（開始画面／被弾ポーズ）：時間が来たら再開
    if (this.state === "intro" || this.state === "respawning") {
      this.interTimer -= dt;
      if (this.interTimer <= 0) {
        if (this.state === "respawning") this.respawnPlayer(); // 自機だけ復活（敵・壁は維持）
        this.state = "playing";
      }
    }

    this.acc += dt;
    while (this.acc >= STEP) {
      this.update(STEP);
      this.acc -= STEP;
    }
    this.render();
    requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    if (this.state !== "playing") return; // クリア／ゲームオーバー中は停止

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
        this.kills[this.enemies[ei].pattern]++; // 撃破数を集計
        this.enemies.splice(ei, 1); // 敵を破壊（FF：弾は所有者を問わず当たる）
        continue;
      }
      // 自機への命中（自爆猶予経過後、または他者の弾）
      if ((b.owner !== 0 || b.age >= SELF_GRACE) && this.near(b.x, b.y, this.pos.x, this.pos.y)) {
        this.onPlayerDeath();
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

    // クリア判定（敵を全滅）
    if (this.enemies.length === 0) {
      this.state = "cleared";
      this.onStageClear?.(); // キャンペーンなら次ステージへ（loadStageで再びplayingになる）
    }
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
      // 1) 壊すブロックを「破壊前のタイル」で確定（手前の壁が奥を守る＝貫通させない）
      const bricks = this.collectBlastBricks(m.x, m.y);
      // 2) 戦車・連鎖も破壊前のタイルで判定（壊すブロックが遮蔽として機能）
      if (this.inBlast(m.x, m.y, this.pos.x, this.pos.y)) playerHit = true;
      this.enemies = this.enemies.filter((e) => {
        if (this.inBlast(m.x, m.y, e.x, e.y)) {
          this.kills[e.pattern]++; // 撃破数を集計
          return false;
        }
        return true;
      });
      this.mines.forEach((o, j) => {
        if (!det.has(j) && this.inBlast(m.x, m.y, o.x, o.y)) {
          det.add(j);
          queue.push(j);
        }
      });
      // 3) 最後にブロックを破壊（↑の判定には影響させない）
      for (const [c, r] of bricks) this.stage.tiles[r][c] = TILE.FLOOR;
    }
    this.mines = this.mines.filter((_, j) => !det.has(j));
    if (playerHit) this.onPlayerDeath();
  }

  // 爆心(mx,my)から(tx,ty)が爆風範囲内かつ壁に遮られていないか。
  private inBlast(mx: number, my: number, tx: number, ty: number): boolean {
    return this.dist(mx, my, tx, ty) < this.blastR && blastReaches(this.stage, mx, my, tx, ty);
  }

  // 爆心(x,y)で壊すべき壊せる壁のセルを列挙（タイルは変更しない）。
  private collectBlastBricks(x: number, y: number): [number, number][] {
    const { cols, rows, cell } = this.stage.grid;
    const out: [number, number][] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (this.stage.tiles[row][col] !== TILE.BRICK) continue;
        const cx = (col + 0.5) * cell;
        const cy = (row + 0.5) * cell;
        if (this.dist(x, y, cx, cy) < this.blastR && blastReaches(this.stage, x, y, cx, cy)) {
          out.push([col, row]);
        }
      }
    }
    return out;
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
        const isStationary = e.pattern === "stationary";
        // 移動型はバンクショットなし（直射のみ）。
        let dir = computeAimDir(this.stage, e.x, e.y, this.pos.x, this.pos.y, isStationary);
        if (dir) {
          // 移動型は照準にばらつき（精度低め）。
          if (!isStationary) dir = rotate(dir, (Math.random() * 2 - 1) * ENEMY_AIM_JITTER);
          this.spawnBullet(e.x, e.y, dir, 1);
          e.facing = Math.atan2(dir.y, dir.x);
          e.cd = isStationary ? ENEMY_COOLDOWN_STATIONARY : ENEMY_COOLDOWN_MOVER;
        } else {
          e.cd = 0.3; // 射線が無いときは少し待って再試行
        }
      }
    }
  }

  private onPlayerDeath(): void {
    this.lives--;
    if (this.lives <= 0) {
      this.state = "gameover";
      this.onGameOver?.();
      return;
    }
    // 残機が残っていれば、区切りポーズ後に自機だけ復活（倒した敵・壊した壁は維持）
    this.state = "respawning";
    this.interTimer = RESPAWN_PAUSE;
  }

  // 自機だけリスポーンする。倒した敵は復活させないが、生き残った敵は定位置(home)へ戻す。
  private respawnPlayer(): void {
    this.pos = { ...this.spawn };
    this.facing = -Math.PI / 2;
    this.bullets = [];
    this.mines = [];
    this.explosions = [];
    for (const e of this.enemies) {
      e.x = e.hx;
      e.y = e.hy;
      e.cd = 0;
      e.facing = Math.PI / 2;
    }
  }

  // ステージを初期状態に戻す（壁・敵・地雷・弾・自機位置）。残機は変更しない。
  private resetStage(): void {
    this.stage.tiles = this.initialTiles.map((row) => [...row]);
    this.enemies = makeEnemies(this.stage);
    this.bullets = [];
    this.mines = [];
    this.explosions = [];
    this.pos = { ...this.spawn };
    this.facing = -Math.PI / 2;
  }

  // 最初からやり直す（残機リセット）。クリア／ゲームオーバー後に呼ぶ。
  restart(): void {
    this.lives = SOLO_LIVES;
    this.kills = { stationary: 0, mover: 0 };
    this.resetStage();
    this.state = "playing";
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
    this.drawHud(ctx);
  }

  // 残機（自機アイコン×数）・敵数・ステージ番号・状態（デバイス座標で重ねる）。
  private drawHud(ctx: CanvasRenderingContext2D): void {
    const iy = 22;
    drawTankIcon(ctx, 20, iy, COLORS.p1);
    ctx.fillStyle = "#222";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(`× ${this.lives}`, 38, iy);
    ctx.font = "14px sans-serif";
    ctx.fillText(`敵 ${this.enemies.length}`, 92, iy);
    if (this.stageLabel) {
      ctx.textAlign = "right";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText(this.stageLabel, ctx.canvas.width - 10, iy);
    }

    if (this.state === "playing") return;
    if (this.state === "intro") {
      this.drawIntro(ctx);
      return;
    }
    if (this.state === "respawning") {
      this.drawMiss(ctx);
      return;
    }
    if (this.state === "gameover") {
      this.drawResult(ctx);
      return;
    }
    // cleared
    const cx = ctx.canvas.width / 2;
    const cy = ctx.canvas.height / 2;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, cy - 48, ctx.canvas.width, 96);
    ctx.fillStyle = "#7CFC9B";
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CLEAR!", cx, cy - 10);
    ctx.fillStyle = "#fff";
    ctx.font = "16px sans-serif";
    ctx.fillText("R キー / リスタートボタンで再挑戦", cx, cy + 26);
  }

  // ゲームオーバー時のリザルト：色別の戦車アイコン×撃破数。
  private drawResult(ctx: CanvasRenderingContext2D): void {
    const cx = ctx.canvas.width / 2;
    const cy = ctx.canvas.height / 2;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    ctx.fillStyle = "#ff8080";
    ctx.font = "bold 40px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("GAME OVER", cx, cy - 78);

    ctx.fillStyle = "#fff";
    ctx.font = "18px sans-serif";
    ctx.fillText("撃破数", cx, cy - 34);

    const entries: { color: string; count: number }[] = [
      { color: COLORS.stationary, count: this.kills.stationary },
      { color: COLORS.mover, count: this.kills.mover },
    ];
    const ew = 120;
    let x = cx - (entries.length * ew) / 2 + ew / 2;
    ctx.font = "24px sans-serif";
    for (const e of entries) {
      drawTankIcon(ctx, x - 24, cy + 8, e.color);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "left";
      ctx.fillText(`× ${e.count}`, x - 4, cy + 8);
      x += ew;
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "16px sans-serif";
    ctx.fillText("R キー / リスタートボタンで再挑戦", cx, cy + 70);
  }

  // 被弾の区切り画面：「ミス！」＋ 残機（自機アイコン×数）。
  private drawMiss(ctx: CanvasRenderingContext2D): void {
    const cx = ctx.canvas.width / 2;
    const cy = ctx.canvas.height / 2;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, cy - 56, ctx.canvas.width, 112);

    ctx.fillStyle = "#ffd23a";
    ctx.font = "bold 34px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ミス！", cx, cy - 20);

    drawTankIcon(ctx, cx - 26, cy + 18, COLORS.p1);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.font = "20px sans-serif";
    ctx.fillText(`× ${this.lives}`, cx - 8, cy + 18);

    ctx.textAlign = "center";
    ctx.fillStyle = "#ccc";
    ctx.font = "13px sans-serif";
    ctx.fillText("まもなく再開…", cx, cy + 46);
  }

  // ステージ開始の区切り画面：ステージ名・出現する敵（色×数）・残機。
  private drawIntro(ctx: CanvasRenderingContext2D): void {
    const cx = ctx.canvas.width / 2;
    const cy = ctx.canvas.height / 2;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 40px sans-serif";
    ctx.fillText(this.stageLabel, cx, cy - 70);

    // 出現する敵（パターン＝色 ごとの数）
    const stat = this.enemies.filter((e) => e.pattern === "stationary").length;
    const mov = this.enemies.filter((e) => e.pattern === "mover").length;
    const entries: { color: string; count: number }[] = [];
    if (stat > 0) entries.push({ color: COLORS.stationary, count: stat });
    if (mov > 0) entries.push({ color: COLORS.mover, count: mov });
    const ew = 90;
    let x = cx - (entries.length * ew) / 2 + ew / 2;
    ctx.font = "22px sans-serif";
    for (const e of entries) {
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(x - 16, cy, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "left";
      ctx.fillText(`×${e.count}`, x, cy);
      x += ew;
    }

    // 残機（自機アイコン×数）
    drawTankIcon(ctx, cx - 26, cy + 52, COLORS.p1);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.font = "20px sans-serif";
    ctx.fillText(`× ${this.lives}`, cx - 8, cy + 52);

    ctx.textAlign = "center";
    ctx.fillStyle = "#ccc";
    ctx.font = "14px sans-serif";
    ctx.fillText("まもなく開始…", cx, cy + 84);
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
