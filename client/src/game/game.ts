// ゲーム本体（段階1）。固定タイムステップでシミュレーションを進め、描画は毎フレーム。
// 現ステップ：自機の移動（壁ずり・敵=障害物）＋射撃（右エイムパッド／タップ・即撃ち）、
// 弾の跳弾・命中・フレンドリーファイア、直進の照準線。

import { TILE } from "../stage/types";
import type { StageData, TileValue } from "../stage/types";
import { ENEMY_TYPES, getEnemyType, type EnemyType } from "../stage/enemyTypes";
import { COLORS, cellCenter, drawBullet, drawExplosion, drawMine, drawTank, renderMap, worldSize } from "./render";
import { circleHitsSolid, slide } from "./physics";
import { advanceBullet, bulletsCollide, type Bullet } from "./bullet";
import { blastReaches, computeAimDir, lineClear } from "./ai";
import { nextStepToward } from "./pathfind";
import { Input } from "./input";
import {
  BEHAVIOR_MAX,
  BEHAVIOR_MIN,
  BULLET_RADIUS,
  BULLET_SPEED,
  DEATH_FX,
  ENEMY_CLOSE,
  ENEMY_MINE_INTERVAL,
  ENEMY_NEAR,
  EXPLOSION_LIFE,
  NEAR_FIRE_MULT,
  MAX_ACTIVE_BULLETS,
  MAX_BOUNCES,
  MAX_MINES,
  MINE_BLAST_CELLS,
  MINE_BLAST_LIFE,
  MINE_FUSE,
  MINE_RADIUS,
  INTRO_PAUSE,
  MAX_TRACKS,
  RESPAWN_PAUSE,
  SELF_GRACE,
  SOLO_LIVES,
  STEP,
  TANK_RADIUS,
  TANK_SPEED,
  TANK_TURN_ALIGN,
  TANK_TURN_RATE,
  TRACK_GAP,
} from "./constants";

type GameState = "intro" | "playing" | "dying" | "respawning" | "cleared" | "gameover";

type RuntimeBehavior = "combat" | "retreat" | "wander";

interface Enemy {
  x: number;
  y: number;
  hx: number; // 初期位置（リスポーン時に戻す）
  hy: number;
  tx: number; // 直近のキャタピラ跡を刻んだ位置
  ty: number;
  type: EnemyType; // タイプ設定（色・速度・射撃など）
  cd: number; // 発射クールダウン残り(秒)
  facing: number; // 砲塔の向き
  behavior: RuntimeBehavior; // 現在の行動軸（移動するタイプのみ使用）
  behaviorTimer: number; // 次に行動軸を切り替えるまでの秒
  wanderX: number; // 無目的移動の向き
  wanderY: number;
  stuckCol: number; // 滞留判定：直近のマス
  stuckRow: number;
  stuckTimer: number; // 同じマスに留まっている秒
  mineCd: number; // 地雷設置のクールダウン残り(秒)
  wpCol: number; // 追跡経路の次の一歩（-1=なし）
  wpRow: number;
  pathTimer: number; // 経路を再計算するまでの秒
}

const HIT_DIST = TANK_RADIUS + BULLET_RADIUS; // 弾と戦車の命中距離

// 角度を [-PI, PI] に正規化する。
function angleNorm(x: number): number {
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

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

// 撃破バッテン印（×）を描く。視認性のため暗いふちどりの上に本体色。
function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const r = TANK_RADIUS * 0.8;
  ctx.lineCap = "round";
  const stroke = (w: number, c: string): void => {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r, y + r);
    ctx.lineTo(x + r, y - r);
    ctx.stroke();
  };
  stroke(8, "rgba(0,0,0,0.5)"); // ふちどり
  stroke(5, color); // 本体
  ctx.lineCap = "butt";
}

// ステージ定義から敵エンティティを生成（初期位置 hx/hy も保持）。
function makeEnemies(stage: StageData): Enemy[] {
  return stage.enemies.map((e) => {
    const c = cellCenter(stage, e);
    return {
      x: c.x,
      y: c.y,
      hx: c.x,
      hy: c.y,
      tx: c.x,
      ty: c.y,
      type: getEnemyType(e.pattern),
      cd: 0,
      facing: Math.PI / 2,
      behavior: "combat",
      behaviorTimer: 0,
      wanderX: 0,
      wanderY: 0,
      stuckCol: Math.floor(c.x / stage.grid.cell),
      stuckRow: Math.floor(c.y / stage.grid.cell),
      stuckTimer: 0,
      mineCd: 1.5,
      wpCol: -1,
      wpRow: -1,
      pathTimer: 0,
    };
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
  private mines: { x: number; y: number; t: number; owner: Enemy | null }[] = [];
  private explosions: { x: number; y: number; t: number; maxR: number; life: number }[] = [];
  private blastR: number;
  private facing = -Math.PI / 2; // 砲塔の向き（描画）
  private heading = -Math.PI / 2; // 車体（キャタピラ）の向き＝移動方向
  private wasMoving = false; // 前フレーム動いていたか（移動中の方向転換判定）
  private acc = 0;
  private last = 0;
  private lives = SOLO_LIVES;
  private state: GameState = "playing";
  private interTimer = 0; // 区切りポーズ／開始画面／大破演出の残り秒
  private pendingGameOver = false; // 大破演出のあとゲームオーバーへ進むか
  private stageLabel = ""; // 「ステージN」表示用
  private kills: Record<string, number> = {}; // タイプ別の撃破数（リザルト用）
  private tracks: { x: number; y: number; a: number }[] = []; // キャタピラ跡
  private deathMarks: { x: number; y: number; color: string }[] = []; // 撃破バッテン印
  private playerTrackFrom = { x: 0, y: 0 }; // 自機の直近の跡位置
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
    this.playerTrackFrom = { ...this.spawn };
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
      this.kills = {}; // 新しいランの開始
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

    this.ageExplosions(dt); // 爆発エフェクトはどの状態でも進める（大破演出のため）

    if (this.state === "dying") {
      // 大破演出 → 終わったらゲームオーバー or 区切りポーズ（自機復活）へ
      this.interTimer -= dt;
      if (this.interTimer <= 0) {
        if (this.pendingGameOver) {
          this.state = "gameover";
          this.onGameOver?.();
        } else {
          this.respawnPlayer(); // 自機だけ復活（敵・壁は維持）
          this.state = "respawning";
          this.interTimer = RESPAWN_PAUSE;
        }
      }
    } else if (this.state === "intro" || this.state === "respawning") {
      this.interTimer -= dt;
      if (this.interTimer <= 0) this.state = "playing";
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

    // 移動（戦車らしい旋回モデル）：車体の向き(heading)を入力方向へ旋回させてから前進。
    // 同方向の継続/再開は遅延なし。停止から別方向は向きを変える時間(=旋回)が要る。
    // 移動中の方向転換は止まらず曲がる（角ばって曲がる）。
    const a = this.input.axis();
    const mag = Math.hypot(a.x, a.y);
    if (mag > 0.05) {
      const inAng = Math.atan2(a.y, a.x);
      // 車体の「軸」に対する前後の角度差。前後どちらかに合っていれば旋回不要（＝逆方向は即バック）。
      const diffF = angleNorm(inAng - this.heading);
      const diffB = angleNorm(inAng - this.heading - Math.PI);
      const forwardCloser = Math.abs(diffF) <= Math.abs(diffB);
      const turnErr = forwardCloser ? diffF : diffB; // 近い側の軸を入力へ寄せる
      const maxTurn = TANK_TURN_RATE * dt;
      this.heading += Math.abs(turnErr) <= maxTurn ? turnErr : Math.sign(turnErr) * maxTurn;
      const aligned =
        Math.min(Math.abs(angleNorm(inAng - this.heading)), Math.abs(angleNorm(inAng - this.heading - Math.PI))) <
        TANK_TURN_ALIGN;
      if (this.wasMoving || aligned) {
        const moveDir = forwardCloser ? this.heading : this.heading + Math.PI; // 前進 or バック
        const step = TANK_SPEED * mag * dt;
        const nx = this.pos.x + Math.cos(moveDir) * step;
        const ny = this.pos.y + Math.sin(moveDir) * step;
        const blocked = (px: number, py: number): boolean =>
          circleHitsSolid(this.stage, px, py, TANK_RADIUS) || this.hitsEnemy(px, py);
        this.pos = slide(this.pos.x, this.pos.y, nx, ny, blocked);
        this.stampTrack(this.pos.x, this.pos.y, this.heading, this.playerTrackFrom);
        this.wasMoving = true;
      } else {
        this.wasMoving = false; // 横方向への新規発進はその場で旋回中
      }
      this.facing = this.heading;
    } else {
      this.wasMoving = false;
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
        this.markKill(this.enemies[ei]); // 撃破数＋バッテン印
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

    // クリア判定（敵を全滅）
    if (this.enemies.length === 0) {
      this.state = "cleared";
      this.onStageClear?.(); // キャンペーンなら次ステージへ（loadStageで再びplayingになる）
    }
  }

  // 地雷を設置（最大 MAX_MINES）。外部ボタンからも呼べる。
  layMine(): void {
    if (this.mines.filter((m) => m.owner === null).length >= MAX_MINES) return;
    this.mines.push({ x: this.pos.x, y: this.pos.y, t: 0, owner: null });
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
          this.markKill(e); // 撃破数＋バッテン印
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

  private addTrack(x: number, y: number, a: number): void {
    this.tracks.push({ x, y, a });
    if (this.tracks.length > MAX_TRACKS) this.tracks.shift();
  }

  // 一定距離以上動いたらキャタピラ跡を刻む（from を現在位置に更新）。
  private stampTrack(x: number, y: number, a: number, from: { x: number; y: number }): void {
    if (this.dist(x, y, from.x, from.y) >= TRACK_GAP) {
      this.addTrack(x, y, a);
      from.x = x;
      from.y = y;
    }
  }

  // 敵の撃破を記録（撃破数の集計＋大破演出＋やられた座標に白いバッテン印）。
  private markKill(e: Enemy): void {
    this.kills[e.type.key] = (this.kills[e.type.key] ?? 0) + 1;
    this.spawnDeathFx(e.x, e.y); // 敵も大破演出
    this.deathMarks.push({ x: e.x, y: e.y, color: "#ffffff" });
  }

  private fire(dir: { x: number; y: number }): void {
    this.spawnBullet(this.pos.x, this.pos.y, dir, 0);
    this.facing = Math.atan2(dir.y, dir.x);
  }

  // owner: 0=自機, 1=敵。砲口（半径の外側）から発射する。弾速・反射回数は指定可。
  private spawnBullet(
    ox: number,
    oy: number,
    dir: { x: number; y: number },
    owner: number,
    speed = BULLET_SPEED,
    bounces = MAX_BOUNCES,
  ): void {
    const off = TANK_RADIUS + BULLET_RADIUS + 2;
    this.bullets.push({
      x: ox + dir.x * off,
      y: oy + dir.y * off,
      vx: dir.x * speed,
      vy: dir.y * speed,
      bounces,
      owner,
      age: 0,
    });
  }

  // 行動軸をタイプの性格に応じた重みで切り替える。
  private pickBehavior(e: Enemy): void {
    const r = Math.random();
    if (e.type.behavior === "chaser") e.behavior = r < 0.6 ? "combat" : "wander"; // 追跡（ほどほど）
    else if (e.type.behavior === "approach") e.behavior = r < 0.8 ? "combat" : "wander";
    else if (e.type.behavior === "kite") e.behavior = r < 0.5 ? "retreat" : r < 0.9 ? "wander" : "combat";
    else e.behavior = r < 0.6 ? "combat" : r < 0.9 ? "wander" : "retreat"; // balanced
    e.behaviorTimer = BEHAVIOR_MIN + Math.random() * (BEHAVIOR_MAX - BEHAVIOR_MIN);
    if (e.behavior === "wander") {
      const a = Math.random() * Math.PI * 2;
      e.wanderX = Math.cos(a);
      e.wanderY = Math.sin(a);
    }
  }

  private updateEnemies(dt: number): void {
    for (const e of this.enemies) {
      const t = e.type;
      const near = this.dist(e.x, e.y, this.pos.x, this.pos.y) < ENEMY_NEAR;

      // 移動（speed>0 のタイプのみ）：行動軸＝戦闘/退避/無目的をランダム切替
      if (t.speed > 0) {
        e.behaviorTimer -= dt;
        if (e.behaviorTimer <= 0) this.pickBehavior(e);
        const dx = this.pos.x - e.x;
        const dy = this.pos.y - e.y;
        const d = Math.hypot(dx, dy);
        let behavior = e.behavior;
        const defensiveType = e.type.behavior === "balanced" || e.type.behavior === "kite";
        if (behavior === "combat" && defensiveType) {
          // 壁越しには突っ込まない：射線が壁で切れていて、かなり近くなければ守備的（退避）に
          // ※攻撃的タイプ(approach/chaser)は退かず、回り込みで追い続ける
          if (d > ENEMY_CLOSE && !lineClear(this.stage, e.x, e.y, this.pos.x, this.pos.y)) behavior = "retreat";
        } else if (behavior === "retreat" && d > ENEMY_NEAR * 1.5) {
          behavior = "wander"; // 遠すぎる退避は徘徊に（端へ逃げ続けない）
        }
        const cell = this.stage.grid.cell;
        let desired: number;
        const pursue = e.type.behavior === "chaser" || e.type.behavior === "approach";
        if (behavior === "combat" && pursue) {
          // 追跡タイプ：BFSで「行けるルートの次の一歩」を求めて回り込む（0.4秒ごと再計算）
          e.pathTimer -= dt;
          if (e.pathTimer <= 0 || e.wpCol < 0) {
            const n = nextStepToward(
              this.stage,
              Math.floor(e.x / cell),
              Math.floor(e.y / cell),
              Math.floor(this.pos.x / cell),
              Math.floor(this.pos.y / cell),
            );
            e.wpCol = n ? n.col : -1;
            e.wpRow = n ? n.row : -1;
            e.pathTimer = 0.4;
          }
          if (e.wpCol >= 0) {
            desired = Math.atan2((e.wpRow + 0.5) * cell - e.y, (e.wpCol + 0.5) * cell - e.x);
          } else {
            desired = Math.atan2(dy, dx); // 隣接/同セル/到達不可は直接
          }
        } else if (behavior === "combat") {
          desired = Math.atan2(dy, dx);
        } else if (behavior === "retreat") {
          desired = Math.atan2(-dy, -dx);
        } else {
          desired = Math.atan2(e.wanderY, e.wanderX);
        }

        // 壁を擦らず回り込む：希望方向から少しずつ角度をずらし、通れる向きへ進む
        const step = t.speed * dt;
        let moved = false;
        let moveAngle = desired;
        for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
          const a = desired + off;
          const tx = e.x + Math.cos(a) * step;
          const ty = e.y + Math.sin(a) * step;
          if (!this.moverBlocked(tx, ty, e)) {
            e.x = tx;
            e.y = ty;
            moveAngle = a;
            moved = true;
            break;
          }
        }
        if (!moved && behavior === "wander") {
          const a = Math.random() * Math.PI * 2;
          e.wanderX = Math.cos(a);
          e.wanderY = Math.sin(a);
        }
        if (moved && this.dist(e.x, e.y, e.tx, e.ty) >= TRACK_GAP) {
          this.addTrack(e.x, e.y, moveAngle); // 履帯は移動方向で刻む
          e.tx = e.x;
          e.ty = e.y;
        }
        // 同じマスに2秒以上留まったら強制的に無目的へ（隅でのハマり防止）
        const cc = Math.floor(e.x / cell);
        const cr = Math.floor(e.y / cell);
        if (cc === e.stuckCol && cr === e.stuckRow) {
          e.stuckTimer += dt;
          if (e.stuckTimer >= 2) {
            e.behavior = "wander";
            const a = Math.random() * Math.PI * 2;
            e.wanderX = Math.cos(a);
            e.wanderY = Math.sin(a);
            e.behaviorTimer = BEHAVIOR_MIN + Math.random() * (BEHAVIOR_MAX - BEHAVIOR_MIN);
            e.stuckTimer = 0;
          }
        } else {
          e.stuckCol = cc;
          e.stuckRow = cr;
          e.stuckTimer = 0;
        }
        if (moved) e.facing = moveAngle; // 普段は進行方向を向く
      }
      // 射線が通っている時だけ砲塔を自機へ向ける（射撃の構え）
      if (lineClear(this.stage, e.x, e.y, this.pos.x, this.pos.y)) {
        e.facing = Math.atan2(this.pos.y - e.y, this.pos.x - e.x);
      }

      // 射撃：自機が近いほど発射間隔を短く。タイプ設定（バンク/精度/弾速/反射/連射）に従う
      e.cd -= dt;
      if (e.cd <= 0) {
        let dir = computeAimDir(this.stage, e.x, e.y, this.pos.x, this.pos.y, t.bank);
        if (dir) {
          if (t.aimJitter > 0) dir = rotate(dir, (Math.random() * 2 - 1) * t.aimJitter);
          const baseAngle = Math.atan2(dir.y, dir.x);
          const spread = 0.14;
          for (let i = 0; i < t.bullets; i++) {
            const a = baseAngle + (i - (t.bullets - 1) / 2) * spread; // 扇状の同時発射
            this.spawnBullet(e.x, e.y, { x: Math.cos(a), y: Math.sin(a) }, 1, t.bulletSpeed, t.bounces);
          }
          e.facing = baseAngle;
          e.cd = near ? t.fireInterval * NEAR_FIRE_MULT : t.fireInterval;
        } else {
          e.cd = 0.3; // 射線が無いときは少し待って再試行
        }
      }

      // 地雷を置くタイプ：上限まで一定間隔で設置
      if (t.maxMines > 0) {
        e.mineCd -= dt;
        if (e.mineCd <= 0) {
          if (this.mines.filter((m) => m.owner === e).length < t.maxMines) {
            this.mines.push({ x: e.x, y: e.y, t: 0, owner: e });
            e.mineCd = ENEMY_MINE_INTERVAL;
          } else {
            e.mineCd = 1.0; // 満杯なら少し待つ
          }
        }
      }
    }
  }

  private onPlayerDeath(): void {
    this.lives--;
    this.spawnDeathFx(this.pos.x, this.pos.y); // 自機が大破する演出
    this.pendingGameOver = this.lives <= 0;
    this.state = "dying"; // 演出 → loop で gameover or respawning へ
    this.interTimer = DEATH_FX;
  }

  // 自機の大破演出（中央の大きな爆発＋周囲に小爆発）。
  private spawnDeathFx(x: number, y: number): void {
    this.explosions.push({ x, y, t: 0, maxR: TANK_RADIUS * 2.6, life: DEATH_FX });
    for (const [ox, oy] of [
      [-18, -10],
      [16, -14],
      [-12, 16],
      [18, 12],
    ]) {
      this.explosions.push({ x: x + ox, y: y + oy, t: 0, maxR: TANK_RADIUS * 1.3, life: DEATH_FX * 0.8 });
    }
  }

  private ageExplosions(dt: number): void {
    for (const ex of this.explosions) ex.t += dt;
    this.explosions = this.explosions.filter((ex) => ex.t < ex.life);
  }

  // 自機だけリスポーンする。倒した敵は復活させないが、生き残った敵は定位置(home)へ戻す。
  private respawnPlayer(): void {
    this.pos = { ...this.spawn };
    this.playerTrackFrom = { ...this.spawn };
    this.facing = -Math.PI / 2;
    this.heading = -Math.PI / 2;
    this.wasMoving = false;
    this.bullets = [];
    this.mines = [];
    this.explosions = [];
    this.tracks = []; // 轍は被弾でリセット（継続しない）。バッテン印は維持
    for (const e of this.enemies) {
      e.x = e.hx;
      e.y = e.hy;
      e.tx = e.hx;
      e.ty = e.hy;
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
    this.tracks = [];
    this.deathMarks = [];
    this.pos = { ...this.spawn };
    this.playerTrackFrom = { ...this.spawn };
    this.facing = -Math.PI / 2;
    this.heading = -Math.PI / 2;
    this.wasMoving = false;
  }

  // 最初からやり直す（残機リセット）。クリア／ゲームオーバー後に呼ぶ。
  restart(): void {
    this.lives = SOLO_LIVES;
    this.kills = {};
    this.resetStage();
    this.state = "playing";
  }

  // 移動型の敵が進めない位置か：壁／自機／他の戦車と重なる。
  private moverBlocked(px: number, py: number, self: Enemy): boolean {
    const r2 = TANK_RADIUS * 2;
    if (circleHitsSolid(this.stage, px, py, TANK_RADIUS)) return true;
    if (this.dist(px, py, this.pos.x, this.pos.y) < r2) return true;
    if (this.enemies.some((o) => o !== self && this.dist(px, py, o.x, o.y) < r2)) return true;
    // 自分が置いた地雷の爆風圏には踏み込まない（外へ離れる方向は許可）
    for (const m of this.mines) {
      if (m.owner !== self) continue;
      const dCand = this.dist(px, py, m.x, m.y);
      if (dCand < this.blastR && dCand < this.dist(self.x, self.y, m.x, m.y)) return true;
    }
    return false;
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
    this.drawTracks(ctx);
    for (const dm of this.deathMarks) drawCross(ctx, dm.x, dm.y, dm.color);
    for (const m of this.mines) drawMine(ctx, m.x, m.y, m.t);
    for (const e of this.enemies) {
      drawTank(ctx, e.x, e.y, e.type.color, e.facing);
    }
    this.drawAimLine(ctx);
    // 大破演出中・ゲームオーバー後は自機を描かない（破壊された）
    if (this.state !== "dying" && this.state !== "gameover") {
      drawTank(ctx, this.pos.x, this.pos.y, COLORS.p1, this.facing);
    }
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

    if (this.state === "playing" || this.state === "dying") return; // 大破演出中は中央表示なし
    if (this.state === "intro") {
      this.drawIntro(ctx);
      return;
    }
    if (this.state === "respawning") {
      this.drawMiss(ctx);
      return;
    }
    if (this.state === "gameover") {
      this.drawResult(ctx, "GAME OVER", "#ff8080");
      return;
    }
    // cleared
    this.drawResult(ctx, "CLEAR!", "#7CFC9B");
  }

  // クリア／ゲームオーバー時のリザルト：色別の戦車アイコン×撃破数。
  private drawResult(ctx: CanvasRenderingContext2D, title: string, titleColor: string): void {
    const cx = ctx.canvas.width / 2;
    const cy = ctx.canvas.height / 2;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    ctx.fillStyle = titleColor;
    ctx.font = "bold 40px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, cx, cy - 78);

    ctx.fillStyle = "#fff";
    ctx.font = "18px sans-serif";
    ctx.fillText("撃破数", cx, cy - 34);

    const entries = Object.keys(this.kills).map((k) => ({ color: ENEMY_TYPES[k].color, count: this.kills[k] }));
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

    // 出現する敵（タイプ＝色 ごとの数）
    const counts: Record<string, number> = {};
    for (const e of this.enemies) counts[e.type.key] = (counts[e.type.key] ?? 0) + 1;
    const entries = Object.keys(counts).map((k) => ({ color: ENEMY_TYPES[k].color, count: counts[k] }));
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

  // キャタピラ跡（薄い2本のトレッド線）。マップの上・戦車の下に描く。
  private drawTracks(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = "rgba(40,40,40,0.13)";
    ctx.lineWidth = 3;
    const half = TANK_RADIUS * 0.45;
    const off = TANK_RADIUS * 0.55;
    for (const t of this.tracks) {
      const dx = Math.cos(t.a);
      const dy = Math.sin(t.a);
      for (const s of [-1, 1]) {
        const ox = t.x + -dy * off * s;
        const oy = t.y + dx * off * s;
        ctx.beginPath();
        ctx.moveTo(ox - dx * half, oy - dy * half);
        ctx.lineTo(ox + dx * half, oy + dy * half);
        ctx.stroke();
      }
    }
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
