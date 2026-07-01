// ゲーム本体（段階1）。固定タイムステップでシミュレーションを進め、描画は毎フレーム。
// 現ステップ：自機の移動（壁ずり・敵=障害物）＋射撃（右エイムパッド／タップ・即撃ち）、
// 弾の跳弾・命中・フレンドリーファイア、直進の照準線。

import { TILE } from "../stage/types";
import type { StageData, TileValue } from "../stage/types";
import { ENEMY_TYPES, getEnemyType, type EnemyType } from "../stage/enemyTypes";
import { COLORS, cellCenter, drawBullet, drawExplosion, drawMine, drawTank, renderMap, worldSize } from "./render";
import { circleHitsSolid, isSolidCell, isWallCell, slide, stepReflect, type RayStep } from "./physics";
import { advanceBullet, bulletsCollide, type Bullet } from "./bullet";
import { blastReaches, computeAimDir, friendlyBlocksPath, lineClear } from "./ai";
import { nextStepToward } from "./pathfind";
import { playSound, setLoop, startBgm, stopBgm } from "./sound";
import { Input } from "./input";
import {
  BEHAVIOR_MAX,
  BEHAVIOR_MIN,
  BULLET_RADIUS,
  BULLET_SPEED,
  DEATH_FX,
  ENEMY_CLOSE,
  ENEMY_OPENING_DELAY,
  ENEMY_STANDOFF,
  ENEMY_STANDOFF_BREAK,
  ENEMY_MINE_INTERVAL,
  ENEMY_NEAR,
  EXPLOSION_LIFE,
  FIRE_STUN,
  NEAR_FIRE_MULT,
  MAX_ACTIVE_BULLETS,
  MAX_BOUNCES,
  MAX_MINES,
  MINE_BLAST_CELLS,
  MINE_BLAST_LIFE,
  MINE_FUSE,
  MINE_RADIUS,
  INTRO_PAUSE,
  STAGE_CLEAR_PAUSE,
  BURST_GAP,
  CLOAK_TIME,
  MAX_LIVES,
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

type GameState = "intro" | "playing" | "dying" | "respawning" | "stageclear" | "cleared" | "gameover";

type RuntimeBehavior = "combat" | "retreat" | "wander";

interface Enemy {
  x: number;
  y: number;
  hx: number; // 初期位置（リスポーン時に戻す）
  hy: number;
  tx: number; // 直近のキャタピラ跡を刻んだ位置
  ty: number;
  type: EnemyType; // タイプ設定（色・速度・射撃など）
  hp: number; // 残りHP（被弾で減り0で破壊）
  age: number; // 出現からの経過秒（透明化タイミング用）
  cd: number; // 発射クールダウン残り(秒)
  facing: number; // 砲塔の向き
  bodyAngle: number; // 車体（移動）の向き
  behavior: RuntimeBehavior; // 現在の行動軸（移動するタイプのみ使用）
  behaviorTimer: number; // 次に行動軸を切り替えるまでの秒
  wdCol: number; // 徘徊の目的セル（-1=未設定）
  wdRow: number;
  stuckCol: number; // 滞留判定：直近のマス
  stuckRow: number;
  stuckTimer: number; // 同じマスに留まっている秒
  mineCd: number; // 地雷設置のクールダウン残り(秒)
  fireStun: number; // 発射直後の停止時間の残り(秒)
  burstLeft: number; // 連射の残り発数
  burstTimer: number; // 次の連射弾までの秒
  wpCol: number; // 追跡経路の次の一歩（-1=なし）
  wpRow: number;
  pathTimer: number; // 経路を再計算するまでの秒
  moving: boolean; // 前フレーム実際に動いたか（プレイヤー同様の旋回モデル用）
}

const HIT_DIST = TANK_RADIUS + BULLET_RADIUS; // 弾と戦車の命中距離

// チュートリアル（BasicDesign §15）の調整値。
const TUT_MOVE_DIST = 160; // 移動ステップ達成に必要な累積移動距離(px)（約2.5セル）
const TUT_DONE_HOLD = 1.8; // 「チュートリアル完了！」を表示してからタイトルへ戻るまでの秒

// Co-op（BasicDesign §12-c）の調整値。
const SNAP_INTERVAL = 1 / 20; // ホストのスナップショット送信間隔（20Hz）
const COOP_P2_OFFSET = 1.5; // P2 未設定ステージで P1 からずらす距離（セル）
const INTERP_DELAY = 0.1; // ゲストの補間遅延（秒）＝この分だけ過去を描いて間を埋める（小12-3）
const INPUT_INTERVAL = 1 / 30; // ゲストの入力送信間隔（30Hz・小12-2）
const OWNER_ENEMY = -1; // 弾の所有者：0..=プレイヤーID、-1=敵

// 線形補間。
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// 角度の最短回りでの線形補間。
function lerpAngle(a: number, b: number, t: number): number {
  return a + angleNorm(b - a) * t;
}

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

// 戦車らしい旋回モデル（自機・敵で共通）。車体の向き heading を目標方向 desiredAng へ
// 旋回レート上限で寄せ、前後どちらか近い軸を使う（真逆はバック＝旋回不要）。
// 更新後の heading・前進方向 moveDir・目標へ整列したか aligned を返す。
// ※実際の前進/スライド・移動フラグの扱いは呼び出し側に委ねる（自機と敵で挙動が異なるため）。
function turnToward(heading: number, desiredAng: number, dt: number): { heading: number; moveDir: number; aligned: boolean } {
  const diffF = angleNorm(desiredAng - heading);
  const diffB = angleNorm(desiredAng - heading - Math.PI);
  const forwardCloser = Math.abs(diffF) <= Math.abs(diffB);
  const turnErr = forwardCloser ? diffF : diffB; // 近い側の軸を目標へ寄せる
  const maxTurn = TANK_TURN_RATE * dt;
  heading += Math.abs(turnErr) <= maxTurn ? turnErr : Math.sign(turnErr) * maxTurn;
  const aligned =
    Math.min(Math.abs(angleNorm(desiredAng - heading)), Math.abs(angleNorm(desiredAng - heading - Math.PI))) <
    TANK_TURN_ALIGN;
  const moveDir = forwardCloser ? heading : heading + Math.PI; // 前進 or バック
  return { heading, moveDir, aligned };
}

// HUD/区切り画面用の小さな戦車アイコン（デバイス座標）。本体・砲塔とも上向き。
// 本編と同じスプライト戦車（drawTank）で描く（未ロード時は図形にフォールバック）。
function drawTankIcon(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, radius = 9): void {
  const up = -Math.PI / 2; // 上向き
  drawTank(ctx, x, y, color, up, up, radius);
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
    const ty = getEnemyType(e.pattern);
    return {
      x: c.x,
      y: c.y,
      hx: c.x,
      hy: c.y,
      tx: c.x,
      ty: c.y,
      type: ty,
      hp: ty.hp,
      age: 0,
      cd: ENEMY_OPENING_DELAY + Math.random() * 0.8, // 開幕は少し待ってから撃つ（開幕即撃ち防止）
      facing: Math.PI / 2,
      bodyAngle: Math.PI / 2,
      behavior: "combat",
      behaviorTimer: 0,
      wdCol: -1,
      wdRow: -1,
      stuckCol: Math.floor(c.x / stage.grid.cell),
      stuckRow: Math.floor(c.y / stage.grid.cell),
      stuckTimer: 0,
      mineCd: 1.5,
      fireStun: 0,
      burstLeft: 0,
      burstTimer: 0,
      wpCol: -1,
      wpRow: -1,
      pathTimer: 0,
      moving: false,
    };
  });
}

// プレイヤー戦車1台分の状態（ソロ＝1台、Co-op＝2台。ホストが両方を同じロジックでsim）。
interface Player {
  id: number; // 弾の owner（0=P1, 1=P2）
  pos: { x: number; y: number };
  spawn: { x: number; y: number };
  facing: number; // 砲塔の向き（描画）
  heading: number; // 車体（キャタピラ）の向き＝移動方向
  wasMoving: boolean; // 前フレーム動いていたか
  fireStun: number; // 発射直後の停止残り(秒)
  idleTime: number; // 動いていない経過秒（敵の角待ち検知）
  trackFrom: { x: number; y: number }; // 直近のキャタピラ跡位置
  alive: boolean; // Co-op: false=待機(観戦)。ソロは常に true
}

// ホスト→ゲストへ送る盤面スナップショット（BasicDesign §12-c）。JSONフル。
export interface Snapshot {
  t: "snapshot";
  st: GameState; // ゲーム状態
  label: string; // ステージ表示名
  lives: number;
  tg: number; // 轍リセット世代番号（変わったらゲストは轍をクリア）
  kills: Record<string, number>[]; // プレイヤーIDごとの撃破数（各自が自分の分を表示）
  players: { id: number; x: number; y: number; h: number; f: number; alive: boolean; n: string }[];
  enemies: { x: number; y: number; b: number; f: number; k: string; hp: number; cl: boolean }[]; // k=タイプキー, cl=透明化中
  bullets: { x: number; y: number; vx: number; vy: number; o: number }[];
  mines: { x: number; y: number; mt: number }[];
  marks: { x: number; y: number; c: string }[];
  exps: { x: number; y: number; et: number; r: number; l: number; c?: string }[];
}

// プレイヤー1台を動かすための入力（移動軸・照準方向）。ローカル入力／受信した相手入力の両方に使う。
interface PlayerInput {
  axis: { x: number; y: number };
  aim: { x: number; y: number } | null;
}

function makePlayer(id: number, spawn: { x: number; y: number }): Player {
  return {
    id,
    pos: { ...spawn },
    spawn: { ...spawn },
    facing: -Math.PI / 2,
    heading: -Math.PI / 2,
    wasMoving: false,
    fireStun: 0,
    idleTime: 0,
    trackFrom: { ...spawn },
    alive: true,
  };
}

// ゲスト側：スナップショットの敵情報から描画用の Enemy を復元する（sim用フィールドはダミー）。
function guestEnemy(e: { x: number; y: number; b: number; f: number; k: string; hp: number; cl: boolean }): Enemy {
  return {
    x: e.x, y: e.y, hx: e.x, hy: e.y, tx: e.x, ty: e.y,
    type: getEnemyType(e.k), hp: e.hp, age: e.cl ? CLOAK_TIME + 1 : 0, cd: 0,
    facing: e.f, bodyAngle: e.b, behavior: "combat", behaviorTimer: 0,
    wdCol: -1, wdRow: -1, stuckCol: 0, stuckRow: 0, stuckTimer: 0,
    mineCd: 0, fireStun: 0, burstLeft: 0, burstTimer: 0,
    wpCol: -1, wpRow: -1, pathTimer: 0, moving: false,
  };
}

export class Game {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private offsetX = 0; // ワールド描画のオフセット（没入時は黒帯ぶん中央へ寄せる・論理px）
  private offsetY = 0;
  private dpr = 1; // devicePixelRatio（内部解像度＝論理サイズ×dpr で高精細化）
  private input: Input;
  private players: Player[] = []; // [0]=P1, [1]=P2(Co-op)。ローカル操作対象は localId。
  private localId = 0; // このクライアントが操作するプレイヤー（ホスト=0 / ゲスト=1）
  // Co-op（BasicDesign §12）。null=ソロ/通常。host=権威でsim実行＋スナップショット送信。guest=描画専用。
  coopRole: "host" | "guest" | null = null;
  onSnapshot: ((snap: Snapshot) => void) | null = null; // host が送信に使う
  private snapAcc = 0; // スナップショット送信レート制御
  private snapBuf: { time: number; snap: Snapshot }[] = []; // ゲストの受信バッファ（補間用）
  private playerNames: string[] = []; // プレイヤーIDごとの表示名（未設定は Player{id+1}）
  onInput: ((msg: unknown) => void) | null = null; // guest が入力送信に使う
  private inputAcc = 0; // 入力送信レート制御（guest）
  private remoteInput: PlayerInput = { axis: { x: 0, y: 0 }, aim: null }; // host が受け取った相手(P2)の入力
  private remoteFires: { x: number; y: number }[] = []; // host が受け取った P2 の発射方向キュー
  private remoteMines = 0; // host が受け取った P2 の地雷設置要求数
  private enemies: Enemy[];
  private bullets: Bullet[] = [];
  private mines: { x: number; y: number; t: number; owner: Enemy | null; by: number }[] = []; // by=置いた人のID（プレイヤー0.. / 敵は-1）
  private explosions: { x: number; y: number; t: number; maxR: number; life: number; color?: string }[] = [];
  private blastR: number;
  private enemyMoving = false; // このフレーム、敵が1体でも移動したか（走行音用）
  private bulletGroup = 0; // 発射グループの採番（同一斉射＝同番号）
  private acc = 0;
  private last = 0;
  private lives = SOLO_LIVES;
  private state: GameState = "playing";
  private interTimer = 0; // 区切りポーズ／開始画面／大破演出の残り秒
  private pendingGameOver = false; // 大破演出のあとゲームオーバーへ進むか
  private coopWiping = false; // Co-op：全滅演出のあとステージを最初からやり直すか
  private stageLabel = ""; // 「ステージN」表示用
  private introHealed = false; // 直近の開始画面で「残機+1回復」を表示するか
  clearGrantsLife = false; // このステージをクリアすると残機+1か（main.tsが面ごとに設定）
  private clearHealed = false; // クリア画面で「残機+1回復」を表示するか
  private killsBy: Record<string, number>[] = []; // プレイヤーIDごとの[敵タイプ→撃破数]（帰属集計・リザルト用）
  private tracks: { x: number; y: number; a: number }[] = []; // キャタピラ跡
  private tracksGen = 0; // 轍リセット世代（クリアするたび+1・スナップショットで送りゲストに反映）
  private lastTracksGen = -1; // ゲスト：最後に反映した轍世代（変化で轍クリア）
  private enemyTrackFrom: { x: number; y: number }[] = []; // ゲスト：敵の轍生成用（インデックス対応の前フレーム位置）
  private deathMarks: { x: number; y: number; color: string }[] = []; // 撃破バッテン印
  private initialTiles: TileValue[][]; // 壊せる壁の復元用

  // 進行制御のコールバック（キャンペーン用）。クリア／ゲームオーバー遷移時に1回呼ぶ。
  onStageClear: (() => void) | null = null;
  onGameOver: (() => void) | null = null;
  onCleared: (() => void) | null = null; // 全クリア（最終リザルト）に入った時

  // チュートリアル（BasicDesign §15）。達成検知ステップ制＋プレイヤー無敵。
  tutorial = false;
  onTutorialDone: (() => void) | null = null; // 完了表示の後に呼ぶ（タイトルへ戻す）
  private tutStep = 0; // 0=移動 1=即撃ち 2=エイム発射 3=地雷 4=仕上げ
  private tutMove = 0; // 累積移動距離（ステップ0用）
  private tutBrickBroken = false; // 地雷で壊せる壁を壊した（ステップ3用）
  private tutFinalEnemies: Enemy[] = []; // 仕上げで出す敵（ステップ4到達まで保留）
  private tutDoneTimer = 0; // 完了表示の残り秒（0で onTutorialDone）

  // ローカル操作対象プレイヤー（ソロ=P1）への委譲アクセサ。
  // 段階2リファクタで単一プレイヤー状態を players[] へ移行したが、呼び出し側はそのまま＝挙動不変。
  private get pos(): { x: number; y: number } {
    return this.players[this.localId].pos;
  }
  private set pos(v: { x: number; y: number }) {
    this.players[this.localId].pos = v;
  }
  private get spawn(): { x: number; y: number } {
    return this.players[this.localId].spawn;
  }
  private set spawn(v: { x: number; y: number }) {
    this.players[this.localId].spawn = v;
  }
  private get wasMoving(): boolean {
    return this.players[this.localId].wasMoving;
  }
  private set wasMoving(v: boolean) {
    this.players[this.localId].wasMoving = v;
  }

  constructor(private canvas: HTMLCanvasElement, private stage: StageData) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D コンテキストを取得できません");
    this.ctx = ctx;
    this.fit();
    // 画面サイズ・向き・全画面の変化に追従してキャンバスを再フィット（スマホ横持ち対応）。
    const refit = (): void => this.fit();
    window.addEventListener("resize", refit);
    window.addEventListener("orientationchange", refit);
    document.addEventListener("fullscreenchange", refit);
    this.input = new Input(canvas);
    this.players = [makePlayer(0, cellCenter(stage, stage.players[0]))];
    this.enemies = makeEnemies(stage);
    this.blastR = MINE_BLAST_CELLS * stage.grid.cell;
    this.initialTiles = stage.tiles.map((row) => [...row]);
    // tiles は自前のコピーを持つ（壁破壊で渡された元ステージ=キャンペーン配列を汚さない）
    this.stage = { ...stage, tiles: this.initialTiles.map((row) => [...row]) };
  }

  // 没入表示（スマホ：CSSで画面いっぱい）か。main.ts が設定する。
  // 実全画面(Android)に頼らずビューポート全体にフィットさせる（iOSでも有効）。
  immersive = false;

  // デモ（アトラクト）モード：自機もAIが操作し、HUD/操作系を描かない。
  // タイトル背景で戦車同士のバトルを自動再生する用途。
  demo = false;
  private demoDest: { x: number; y: number } | null = null;
  private demoDestTimer = 0;
  private demoFireCd = 0;
  private demoMineCd = 3;
  // 外部からの再フィット要求（没入ON/OFF切替時など）。
  refit(): void {
    this.fit();
  }

  // 画面に合わせてキャンバスサイズと拡大率を設定（ステージごとにサイズが違ってもよい）。
  // 幅・高さの両方に収める（全画面/スマホ横持ちで見切れないように）。
  // 没入時はビューポート全体（操作ボタンは画面の四隅にオーバーレイ＝縦予約しない）。
  // 論理(CSS)サイズ。描画コードはこの座標系で行い、内部解像度は dpr 倍にして高精細化する。
  private lw(): number {
    return this.canvas.width / this.dpr;
  }
  private lh(): number {
    return this.canvas.height / this.dpr;
  }

  private fit(): void {
    const { w, h } = worldSize(this.stage);
    const dpr = Math.min(window.devicePixelRatio || 1, 3); // 上限3で巨大化防止
    this.dpr = dpr;
    let logicalW: number;
    let logicalH: number;
    if (this.immersive) {
      // 没入（スマホ）：表示は画面いっぱい。アリーナは中央に黒帯込みで描く。
      // → 黒帯部分もキャンバス内なので、そこにタッチしてパッドを置ける。
      logicalW = Math.floor(window.innerWidth);
      logicalH = Math.floor(window.innerHeight);
      this.scale = Math.min((logicalW - 4) / w, (logicalH - 4) / h);
      this.offsetX = (logicalW - w * this.scale) / 2;
      this.offsetY = (logicalH - h * this.scale) / 2;
    } else {
      // 通常(PC)/全画面：表示＝アリーナサイズ（CSSで中央寄せ・レターボックス）。
      const full = !!document.fullscreenElement;
      const availW = full ? window.innerWidth - 4 : Math.min(1100, window.innerWidth - 20);
      const availH = full ? window.innerHeight - 4 : window.innerHeight - 120;
      this.scale = Math.min(availW / w, availH / h);
      logicalW = Math.round(w * this.scale);
      logicalH = Math.round(h * this.scale);
      this.offsetX = 0;
      this.offsetY = 0;
    }
    // 内部解像度を物理ピクセルへ合わせて高精細化。
    this.canvas.width = Math.round(logicalW * dpr);
    this.canvas.height = Math.round(logicalH * dpr);
    // 表示サイズは論理サイズに固定（通常のゲーム画面）。
    // デモ背景(#demo-bg)は CSS の object-fit:contain / 100vw で引き伸ばすので、
    // インラインstyleを設定するとそれを上書きしてしまうため設定しない。
    if (this.demo) {
      // デモは CSS(object-fit/100vw)で表示するので、構築時に付いたインラインstyleを消す
      this.canvas.style.width = "";
      this.canvas.style.height = "";
    } else {
      this.canvas.style.width = `${logicalW}px`;
      this.canvas.style.height = `${logicalH}px`;
    }
  }

  // 別ステージを読み込む（キャンペーンの次ステージ等）。resetLives で残機を初期化するか選ぶ。
  loadStage(stage: StageData, resetLives: boolean): void {
    // チュートリアル/Co-op 状態は既定で解除（start* はこの後にロールを立てる）。
    this.tutorial = false;
    this.tutDoneTimer = 0;
    this.coopRole = null;
    this.spawn = cellCenter(stage, stage.players[0]);
    this.blastR = MINE_BLAST_CELLS * stage.grid.cell;
    this.initialTiles = stage.tiles.map((row) => [...row]);
    // tiles は自前のコピーを持つ（壁破壊で渡された元ステージ=キャンペーン配列を汚さない）
    this.stage = { ...stage, tiles: this.initialTiles.map((row) => [...row]) };
    this.fit();
    if (resetLives) {
      this.lives = SOLO_LIVES;
      this.killsBy = []; // 新しいランの開始（プレイヤー別撃破をリセット）
      startBgm(0.2); // リセット（新しいラン）はBGMを頭から
    }
    this.resetStage();
    this.state = "playing";
  }

  // ステージ開始の区切り画面を表示する（キャンペーンで各ステージ開始時に呼ぶ）。
  // healed=true なら開始画面に「残機 +1 回復！」を表示する。
  beginStage(label: string, healed = false): void {
    this.stageLabel = label;
    this.introHealed = healed;
    this.state = "intro";
    this.interTimer = INTRO_PAUSE;
  }

  // チュートリアル開始（BasicDesign §15）。練習ステージを読み込み、ステップ進行を初期化する。
  // 仕上げ用の敵はステップ5到達まで出さない（途中で誤って倒してクリアにならないように退避）。
  startTutorial(stage: StageData): void {
    this.loadStage(stage, true); // 壁・敵を生成（残機リセット）。※内部で tutorial=false に戻る
    this.tutorial = true; // loadStage の後に立てる（順序重要）
    this.tutFinalEnemies = this.enemies; // 仕上げ用に退避
    this.enemies = []; // ステップ5到達まで敵は出さない
    this.tutStep = 0;
    this.tutMove = 0;
    this.tutBrickBroken = false;
    this.tutDoneTimer = 0;
    this.beginStage("チュートリアル");
  }

  // チュートリアルのステップ進行（毎フレーム呼ぶ）。各操作の達成イベントで次へ進める。
  private tutAdvance(moved: number, fired: boolean, aimed: boolean): void {
    if (this.tutDoneTimer > 0) return; // 完了演出中は進めない
    switch (this.tutStep) {
      case 0: // 移動
        this.tutMove += moved;
        if (this.tutMove >= TUT_MOVE_DIST) this.tutStep = 1;
        break;
      case 1: // 即撃ち（1発撃つ）
        if (fired) this.tutStep = 2;
        break;
      case 2: // エイム発射（狙って撃つ）
        if (aimed) this.tutStep = 3;
        break;
      case 3: // 地雷で壊せる壁を壊す
        if (this.tutBrickBroken) {
          this.tutStep = 4;
          this.enemies = this.tutFinalEnemies; // 仕上げの敵を出す
          this.tutFinalEnemies = [];
        }
        break;
      case 4: // 仕上げ（敵を撃破）
        if (this.enemies.length === 0) {
          this.tutDoneTimer = TUT_DONE_HOLD;
          playSound("clear", { volume: 0.7 });
        }
        break;
    }
  }

  // ===== Co-op（BasicDesign §12）=====
  // 2人分の開始位置（P2 未設定ステージは P1 の隣に自動配置＝中12-e の保険）。
  private coopSpawns(stage: StageData): [Player, Player] {
    const s0 = cellCenter(stage, stage.players[0]);
    const s1 = stage.players[1]
      ? cellCenter(stage, stage.players[1])
      : { x: s0.x + stage.grid.cell * COOP_P2_OFFSET, y: s0.y };
    return [makePlayer(0, s0), makePlayer(1, s1)];
  }

  // ホストとして Co-op を開始（権威＝simを実行し、スナップショットを送る）。
  startCoopHost(stage: StageData): void {
    this.loadStage(stage, true); // 壁・敵・残機を初期化
    this.coopRole = "host";
    this.localId = 0;
    this.players = this.coopSpawns(stage);
    this.snapAcc = 0;
    this.remoteInput = { axis: { x: 0, y: 0 }, aim: null };
    this.remoteFires = [];
    this.remoteMines = 0;
    this.coopWiping = false;
    this.beginStage("Co-op");
  }

  // ゲストとして Co-op を開始（描画専用。simは回さず受信スナップショットを表示）。
  startCoopGuest(stage: StageData): void {
    this.loadStage(stage, true);
    this.coopRole = "guest";
    this.localId = 1;
    this.players = this.coopSpawns(stage);
    this.snapBuf = []; // 前セッションの受信バッファを破棄
    this.lastTracksGen = -1; // 最初のスナップショットで必ず轍を同期
    this.enemyTrackFrom = [];
    this.state = "playing"; // 表示状態はスナップショットで上書きされる
  }

  // 現在の盤面をスナップショットにまとめる（ホスト送信用）。
  private buildSnapshot(): Snapshot {
    return {
      t: "snapshot",
      st: this.state,
      label: this.stageLabel,
      lives: this.lives,
      tg: this.tracksGen,
      kills: this.killsBy,
      players: this.players.map((p) => ({ id: p.id, x: p.pos.x, y: p.pos.y, h: p.heading, f: p.facing, alive: p.alive, n: this.playerName(p.id) })),
      enemies: this.enemies.map((e) => ({
        x: e.x, y: e.y, b: e.bodyAngle, f: e.facing, k: e.type.key, hp: e.hp,
        cl: e.type.invisible && e.age >= CLOAK_TIME,
      })),
      bullets: this.bullets.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, o: b.owner })),
      mines: this.mines.map((m) => ({ x: m.x, y: m.y, mt: m.t })),
      marks: this.deathMarks.map((d) => ({ x: d.x, y: d.y, c: d.color })),
      exps: this.explosions.map((ex) => ({ x: ex.x, y: ex.y, et: ex.t, r: ex.maxR, l: ex.life, c: ex.color })),
    };
  }

  // 受信スナップショットをバッファへ積む（ゲスト）。実反映は描画前に interpolateGuest で行う。
  applySnapshot(snap: Snapshot): void {
    if (this.coopRole !== "guest") return;
    this.snapBuf.push({ time: performance.now(), snap });
    // 古いものは捨てる（補間に使う直近2枚＋余裕があれば十分）。
    const cutoff = performance.now() - 1000;
    while (this.snapBuf.length > 2 && this.snapBuf[0].time < cutoff) this.snapBuf.shift();
  }

  // 描画直前に、約 INTERP_DELAY 過去の盤面を補間して各フィールドへ反映する（ゲスト・§12-d）。
  private interpolateGuest(): void {
    const buf = this.snapBuf;
    if (buf.length === 0) return;
    const rt = performance.now() - INTERP_DELAY * 1000; // 描画する仮想時刻（少し過去）
    let i0 = -1;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i].time <= rt) i0 = i;
      else break;
    }
    if (i0 < 0) return this.applyDirectSnapshot(buf[0].snap); // まだ過去が無い→最古をそのまま
    const s0 = buf[i0];
    const s1 = buf[i0 + 1];
    if (!s1) return this.applyDirectSnapshot(s0.snap); // 未来が無い→最新をそのまま
    const span = s1.time - s0.time || 1;
    const a = Math.max(0, Math.min(1, (rt - s0.time) / span));
    this.applyInterp(s0.snap, s1.snap, a, (rt - s0.time) / 1000);
  }

  // s0→s1 を係数 a で補間して反映。dt0=s0からの経過秒（弾の外挿用）。
  private applyInterp(s0: Snapshot, s1: Snapshot, a: number, dt0: number): void {
    this.state = s1.st; // 状態・ラベル等の離散値は新しい方
    this.stageLabel = s1.label;
    this.lives = s1.lives;
    this.syncTracksGen(s1.tg);
    this.killsBy = s1.kills; // 各自の撃破数（自分の分を表示に使う）
    for (const p1 of s1.players) {
      const p = this.players[p1.id];
      if (!p) continue;
      const p0 = s0.players.find((q) => q.id === p1.id) ?? p1;
      p.pos.x = lerp(p0.x, p1.x, a);
      p.pos.y = lerp(p0.y, p1.y, a);
      p.heading = lerpAngle(p0.h, p1.h, a);
      p.facing = lerpAngle(p0.f, p1.f, a);
      p.alive = p1.alive;
      this.playerNames[p1.id] = p1.n;
    }
    // 敵：枚数が一致する間はインデックス対応で補間、変化時は新しい方をそのまま。
    if (s0.enemies.length === s1.enemies.length) {
      this.enemies = s1.enemies.map((e1, i) => {
        const e0 = s0.enemies[i];
        return guestEnemy({ ...e1, x: lerp(e0.x, e1.x, a), y: lerp(e0.y, e1.y, a), b: lerpAngle(e0.b, e1.b, a), f: lerpAngle(e0.f, e1.f, a) });
      });
    } else {
      this.enemies = s1.enemies.map(guestEnemy);
    }
    // 弾：プレイ中は s0 の弾を速度で dt0 ぶん外挿（高速で枚数が変わりやすいため）。
    // 停止中（クリア/大破演出/リザルト等）は外挿すると止まった弾がガタつくので、位置をそのまま使う。
    const moving = s1.st === "playing";
    this.bullets = s0.bullets.map((b) => ({
      x: b.x + (moving ? b.vx * dt0 : 0),
      y: b.y + (moving ? b.vy * dt0 : 0),
      vx: b.vx, vy: b.vy, bounces: 0, owner: b.o, age: 1, group: 0,
    }));
    this.mines = s1.mines.map((m) => ({ x: m.x, y: m.y, t: m.mt, owner: null, by: -1 }));
    this.deathMarks = s1.marks.map((d) => ({ x: d.x, y: d.y, color: d.c }));
    this.explosions = s1.exps.map((ex) => ({ x: ex.x, y: ex.y, t: ex.et, maxR: ex.r, life: ex.l, color: ex.c }));
  }

  // スナップショットを補間せずそのまま反映（バッファ端のフォールバック）。
  private applyDirectSnapshot(snap: Snapshot): void {
    this.state = snap.st;
    this.stageLabel = snap.label;
    this.lives = snap.lives;
    this.syncTracksGen(snap.tg);
    this.killsBy = snap.kills; // 各自の撃破数
    for (const ps of snap.players) {
      const p = this.players[ps.id];
      if (!p) continue;
      p.pos.x = ps.x;
      p.pos.y = ps.y;
      p.heading = ps.h;
      p.facing = ps.f;
      p.alive = ps.alive;
      this.playerNames[ps.id] = ps.n;
    }
    this.enemies = snap.enemies.map(guestEnemy);
    this.bullets = snap.bullets.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, bounces: 0, owner: b.o, age: 1, group: 0 }));
    this.mines = snap.mines.map((m) => ({ x: m.x, y: m.y, t: m.mt, owner: null, by: -1 }));
    this.deathMarks = snap.marks.map((d) => ({ x: d.x, y: d.y, color: d.c }));
    this.explosions = snap.exps.map((ex) => ({ x: ex.x, y: ex.y, t: ex.et, maxR: ex.r, life: ex.l, color: ex.c }));
  }

  // 残機を1回復（上限 MAX_LIVES）。回復できたら true。
  gainLife(): boolean {
    if (this.lives >= MAX_LIVES) return false;
    this.lives++;
    return true;
  }

  // 操作モード切替（PC=マウスカーソル照準 / スマホ=スティック）。
  setInputMode(mode: "mobile" | "pc"): void {
    this.input.setMode(mode);
  }

  // ===== デモ（アトラクト）用オートパイロット =====
  // 自機を「徘徊しつつ最寄りの敵を撃つ」AIで動かす。タイトル背景のバトル演出用。
  private demoNearestEnemy(): Enemy | null {
    let best: Enemy | null = null;
    let bd = Infinity;
    for (const e of this.enemies) {
      const d = this.dist(this.pos.x, this.pos.y, e.x, e.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  // ランダムな床マスの中心を返す（徘徊の目的地）。
  private demoRandomFloor(): { x: number; y: number } {
    const { cols, rows, cell } = this.stage.grid;
    for (let i = 0; i < 40; i++) {
      const c = 1 + Math.floor(Math.random() * (cols - 2));
      const r = 1 + Math.floor(Math.random() * (rows - 2));
      if (!isSolidCell(this.stage, c, r)) return { x: (c + 0.5) * cell, y: (r + 0.5) * cell };
    }
    return { ...this.pos };
  }

  // 移動入力（axis相当）：目的地へ向かう。近づく/時間切れ/未設定で目的地を取り直す。
  private demoAxis(dt: number): { x: number; y: number } {
    this.demoDestTimer -= dt;
    const reached = this.demoDest && this.dist(this.pos.x, this.pos.y, this.demoDest.x, this.demoDest.y) < this.stage.grid.cell;
    if (!this.demoDest || reached || this.demoDestTimer <= 0) {
      this.demoDest = this.demoRandomFloor();
      this.demoDestTimer = 1.5 + Math.random() * 2.5;
    }
    const dx = this.demoDest.x - this.pos.x;
    const dy = this.demoDest.y - this.pos.y;
    const m = Math.hypot(dx, dy) || 1;
    return { x: dx / m, y: dy / m };
  }

  // 砲塔の向き（最寄り敵へ）。
  private demoAimDir(): { x: number; y: number } | null {
    const e = this.demoNearestEnemy();
    if (!e) return null;
    const dx = e.x - this.pos.x;
    const dy = e.y - this.pos.y;
    const m = Math.hypot(dx, dy) || 1;
    return { x: dx / m, y: dy / m };
  }

  // 射撃・地雷（クールダウン制御）。射線（直射/跳弾）が取れる時だけ撃つ。
  private demoCombat(dt: number): void {
    this.demoFireCd -= dt;
    if (this.demoFireCd <= 0) {
      const e = this.demoNearestEnemy();
      const me = this.players[this.localId];
      const canShoot = this.countPlayerBullets(me.id) < MAX_ACTIVE_BULLETS;
      const dir = e && canShoot ? computeAimDir(this.stage, this.pos.x, this.pos.y, e.x, e.y, true, MAX_BOUNCES) : null;
      if (dir) {
        this.fireFrom(me, dir);
        this.demoFireCd = 0.6 + Math.random() * 0.8;
      } else {
        this.demoFireCd = 0.25; // 射線が無ければ少し待って再試行
      }
    }
    this.demoMineCd -= dt;
    if (this.demoMineCd <= 0) {
      if (Math.random() < 0.3) this.layMine();
      this.demoMineCd = 4 + Math.random() * 5;
    }
  }

  // 自機の照準方向：PC=マウスカーソルへ / スマホ=エイムパッド。無ければ null。
  private playerAimDir(): { x: number; y: number } | null {
    if (this.input.isPc()) {
      const c = this.input.getCursor();
      if (!c) return null;
      const dx = (c.x - this.offsetX) / this.scale - this.pos.x;
      const dy = (c.y - this.offsetY) / this.scale - this.pos.y;
      const m = Math.hypot(dx, dy);
      if (m < 1) return null;
      return { x: dx / m, y: dy / m };
    }
    return this.input.aimDir();
  }

  // 1台を入力で動かす（戦車らしい旋回モデル）。ソロ/ホスト共通＝P1もP2も同じロジック。
  // 車体の向き(heading)を入力方向へ旋回させてから前進。移動中の方向転換は止まらず曲がる。
  private movePlayer(p: Player, inp: PlayerInput, dt: number): void {
    if (p.fireStun > 0) p.fireStun -= dt; // 発射直後は停止
    const a = inp.axis;
    const mag = Math.hypot(a.x, a.y);
    if (mag > 0.05 && p.fireStun <= 0) {
      const inAng = Math.atan2(a.y, a.x);
      const turn = turnToward(p.heading, inAng, dt);
      p.heading = turn.heading;
      if (p.wasMoving || turn.aligned) {
        const step = TANK_SPEED * mag * dt;
        const nx = p.pos.x + Math.cos(turn.moveDir) * step;
        const ny = p.pos.y + Math.sin(turn.moveDir) * step;
        const blocked = (px: number, py: number): boolean =>
          circleHitsSolid(this.stage, px, py, TANK_RADIUS) || this.hitsEnemy(px, py);
        p.pos = slide(p.pos.x, p.pos.y, nx, ny, blocked);
        this.stampTrack(p.pos.x, p.pos.y, p.heading, p.trackFrom);
        p.wasMoving = true;
      } else {
        p.wasMoving = false; // 横方向への新規発進はその場で旋回中
      }
      p.facing = p.heading;
    } else {
      p.wasMoving = false;
    }
    p.idleTime = p.wasMoving ? 0 : p.idleTime + dt; // 角待ち検知
    if (inp.aim) p.facing = Math.atan2(inp.aim.y, inp.aim.x); // 照準中は砲塔を照準方向へ
  }

  // プレイヤーの表示名を設定（ホスト=自分[0]・受信したゲスト名[1] など）。
  setPlayerName(id: number, name: string): void {
    this.playerNames[id] = name;
  }
  // 表示名（未設定は Player{id+1}）。
  private playerName(id: number): string {
    return this.playerNames[id] || `Player${id + 1}`;
  }

  // ゲストから届いた入力を保存（ホストが P2 駆動に使う）。移動/照準は最新、発射/地雷はキューに追加。
  applyRemoteInput(msg: {
    ax: number;
    ay: number;
    aim: [number, number] | null;
    fires?: [number, number][];
    mines?: number;
  }): void {
    this.remoteInput = {
      axis: { x: msg.ax, y: msg.ay },
      aim: msg.aim ? { x: msg.aim[0], y: msg.aim[1] } : null,
    };
    if (msg.fires) for (const d of msg.fires) this.remoteFires.push({ x: d[0], y: d[1] });
    if (msg.mines) this.remoteMines += msg.mines;
  }

  // ゲスト：轍リセット世代が変わったらローカルの轍をクリア（ホストの被弾/リセットに追従）。
  private syncTracksGen(tg: number): void {
    if (tg !== this.lastTracksGen) {
      this.tracks = [];
      this.enemyTrackFrom = []; // 敵の轍の前フレーム位置も破棄
      this.lastTracksGen = tg;
    }
  }

  // ゲスト：補間後の位置の移動からキャタピラ跡をローカル生成する（轍はスナップショットに含めないため）。
  private stampGuestTracks(): void {
    for (const p of this.players) {
      if (!p.alive) continue;
      this.stampTrack(p.pos.x, p.pos.y, p.heading, p.trackFrom);
    }
    // 敵の轍：敵IDが無いためインデックス対応で前フレーム位置から刻む（近似）。
    const prev = this.enemyTrackFrom;
    const cell = this.stage.grid.cell;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      const p = prev[i];
      if (!p) {
        prev[i] = { x: e.x, y: e.y };
        continue;
      }
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d >= cell) {
        // 大きな飛び＝敵の入れ替え/リセット → 追従のみ（轍は刻まない）
        p.x = e.x;
        p.y = e.y;
      } else if (d >= TRACK_GAP) {
        this.addTrack(e.x, e.y, e.bodyAngle); // 履帯は車体向きで刻む
        p.x = e.x;
        p.y = e.y;
      }
    }
    prev.length = this.enemies.length; // 敵が減ったら余分を切る
  }

  // ゲスト：自分の操作（移動軸・照準・発射・地雷）を一定間隔でホストへ送る（§12-c）。
  // 発射は方向を解決して送る（ホストはゲストのカーソルを持たないため）。
  private sendGuestInput(dt: number): void {
    if (!this.onInput) return;
    this.inputAcc += dt;
    if (this.inputAcc < INPUT_INTERVAL) return;
    this.inputAcc -= INPUT_INTERVAL;
    const me = this.players[this.localId];
    const a = this.input.axis();
    const aim = this.playerAimDir();
    const fallback = { x: Math.cos(me.facing), y: Math.sin(me.facing) };
    const fires = this.input.takeFires().map((f) => {
      const d = f.cursor ? (this.playerAimDir() ?? fallback) : (f.dir ?? fallback);
      return [d.x, d.y] as [number, number];
    });
    const mines = this.input.takeMines();
    this.onInput({ t: "input", ax: a.x, ay: a.y, aim: aim ? [aim.x, aim.y] : null, fires, mines });
  }

  start(): void {
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  // タイトル/メニュー表示中は更新を止める（入力の暴発・無駄な計算を防ぐ）。
  private paused = false;
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
    this.last = performance.now();
  }

  // 全クリア（最終リザルト）へ遷移。BGM停止＋コールバック通知（リザルトUI表示用）。
  private enterCleared(): void {
    this.state = "cleared";
    stopBgm();
    this.onCleared?.();
  }

  private loop = (t: number): void => {
    if (this.paused) {
      this.last = t;
      requestAnimationFrame(this.loop);
      return;
    }
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (dt > 0.25) dt = 0.25;

    this.ageExplosions(dt); // 爆発エフェクトはどの状態でも進める（大破演出のため）

    // ゲストは状態遷移をホストのスナップショットに任せる（ローカルでは進めない）。
    if (this.coopRole !== "guest") {
    if (this.state === "dying") {
      // 大破演出 → 終わったらゲームオーバー or 区切りポーズ（自機復活）へ
      this.interTimer -= dt;
      if (this.interTimer <= 0) {
        if (this.coopWiping) {
          // Co-op 全滅 → ステージを最初からやり直し（2人とも復活・敵/壁リセット）
          this.coopWiping = false;
          this.killsBy = []; // 新しい挑戦＝撃破数を0から数え直す
          this.resetStage();
          startBgm(0.2);
          this.beginStage("Co-op");
        } else if (this.pendingGameOver) {
          this.state = "gameover";
          playSound("gameover", { volume: 0.7 }); // ゲームオーバー音
          this.onGameOver?.();
        } else {
          this.respawnPlayer(); // 自機だけ復活（敵・壁は維持）
          this.state = "respawning";
          this.interTimer = RESPAWN_PAUSE;
        }
      }
    } else if (this.state === "intro" || this.state === "respawning") {
      this.interTimer -= dt;
      if (this.interTimer <= 0) {
        const wasRespawning = this.state === "respawning";
        this.state = "playing";
        this.input.takeFires(); // 開始直前までに溜まったクリックを破棄（暴発防止）
        this.input.takeMines();
        if (wasRespawning) startBgm(0.2); // 復活でプレイ再開→BGMを頭から（ステージ移行では再開しない）
      }
    } else if (this.state === "stageclear") {
      // クリアポップアップ表示 → 待機後に次ステージへ。進む先が無ければ最終リザルトへ
      this.interTimer -= dt;
      if (this.interTimer <= 0) {
        this.onStageClear?.(); // キャンペーン：次ステージをロード（intro/playingへ遷移）
        if (this.state === "stageclear") {
          this.enterCleared(); // 進む先なし＝全クリア → 最終リザルト
        }
      }
    }
    }

    this.acc += dt;
    while (this.acc >= STEP) {
      this.update(STEP);
      this.acc -= STEP;
    }
    if (this.coopRole === "guest") {
      this.interpolateGuest(); // 受信バッファから補間して反映
      this.stampGuestTracks(); // 補間後の移動から轍をローカル生成（轍は同期しないため）
      this.sendGuestInput(dt); // 自分の操作をホストへ送る
    }
    this.render();

    // ホストは一定間隔で盤面スナップショットを送る（§12-c）。
    if (this.coopRole === "host" && this.onSnapshot) {
      this.snapAcc += dt;
      if (this.snapAcc >= SNAP_INTERVAL) {
        this.snapAcc -= SNAP_INTERVAL;
        this.onSnapshot(this.buildSnapshot());
      }
    }
    requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    if (this.coopRole === "guest") {
      // ゲストは描画専用＝simを回さない。入力は sendGuestInput が送信時に取り出すのでここでは消費しない。
      return;
    }
    if (this.state !== "playing") {
      // 開始前カウントダウン・ミス待機・クリア/GO中のクリックは無効化（再開と同時の暴発防止）
      this.input.takeFires();
      this.input.takeMines();
      return;
    }

    // チュートリアル完了表示中：少し見せてからタイトルへ戻す。
    if (this.tutorial && this.tutDoneTimer > 0) {
      this.tutDoneTimer -= dt;
      if (this.tutDoneTimer <= 0) {
        this.tutorial = false;
        this.onTutorialDone?.();
      }
    }
    const tutFromX = this.pos.x; // チュートリアルの移動距離計測用
    const tutFromY = this.pos.y;
    let tutFired = false; // このフレームに撃ったか
    let tutAimed = false; // このフレームに狙って撃ったか（PCクリック or ドラッグ照準）

    // 移動＋照準：ローカル機を入力で動かす。Co-op ホストは P2 を相手の入力で同じロジックで動かす。
    const localInput: PlayerInput = this.demo
      ? { axis: this.demoAxis(dt), aim: this.demoAimDir() }
      : { axis: this.input.axis(), aim: this.playerAimDir() };
    const localPlayer = this.players[this.localId];
    if (localPlayer.alive) this.movePlayer(localPlayer, localInput, dt);
    if (this.coopRole === "host" && this.players[1]?.alive) {
      this.movePlayer(this.players[1], this.remoteInput, dt); // P2＝ゲストの入力で駆動
    }

    // 発射要求の処理
    if (this.demo) {
      this.demoCombat(dt); // オートパイロットの射撃・地雷
    } else {
      const me = this.players[this.localId];
      for (const f of this.input.takeFires()) {
        if (!me.alive) continue; // 死亡中(待機)は撃たない（入力は消費）
        if (this.countPlayerBullets(me.id) >= MAX_ACTIVE_BULLETS) break;
        const fallback = { x: Math.cos(me.facing), y: Math.sin(me.facing) };
        const dir = f.cursor ? (this.playerAimDir() ?? fallback) : (f.dir ?? fallback);
        this.fireFrom(me, dir);
        tutFired = true;
        if (f.cursor || f.dir) tutAimed = true; // PCクリック / エイムパッドのドラッグ＝狙い撃ち
      }
    }
    // Co-op ホスト：ゲスト(P2)の発射・地雷を反映（FF=ON）。
    if (this.coopRole === "host" && this.players[1]?.alive) {
      const p2 = this.players[1];
      for (const d of this.remoteFires) {
        if (this.countPlayerBullets(p2.id) >= MAX_ACTIVE_BULLETS) break;
        this.fireFrom(p2, d);
      }
      this.remoteFires = [];
      for (let n = this.remoteMines; n > 0; n--) this.layMineFrom(p2);
      this.remoteMines = 0;
    }

    // 敵AI（移動＋射撃）
    this.updateEnemies(dt);

    // 弾の更新と命中
    const alive: Bullet[] = [];
    const mineHits: number[] = []; // 弾が当たった地雷（即起爆）
    for (const b of this.bullets) {
      const prevBounces = b.bounces;
      if (!advanceBullet(this.stage, b, dt)) {
        // 反射回数を使い切った弾が壁に当たって消滅 → 小さく爆発（演出のみ・ダメージなし）
        this.explosions.push({ x: b.x, y: b.y, t: 0, maxR: BULLET_RADIUS * 2, life: EXPLOSION_LIFE });
        continue;
      }
      if (b.bounces < prevBounces) playSound("bounce", { volume: 0.4, throttleMs: 50 }); // 跳弾音（先頭無音は自動スキップ）
      const ei = this.enemies.findIndex((e) => this.dist(b.x, b.y, e.x, e.y) < this.er(e) + BULLET_RADIUS);
      if (ei >= 0) {
        const en = this.enemies[ei];
        en.hp--;
        if (en.hp <= 0) {
          this.markKill(en, b.owner); // 撃破数（撃った人に帰属）＋大破演出＋バッテン印
          this.enemies.splice(ei, 1);
        } else {
          this.hitFx(b.x, b.y); // HPが残る敵は小ヒット表示
        }
        continue; // 弾は消費（FF：所有者を問わず当たる）
      }
      // プレイヤーへの命中（自機は自爆猶予経過後・他者の弾はFFで常に当たる）。生存プレイヤーを走査。
      let hitPlayer: Player | null = null;
      for (const p of this.players) {
        if (!p.alive) continue;
        if ((b.owner !== p.id || b.age >= SELF_GRACE) && this.near(b.x, b.y, p.pos.x, p.pos.y)) {
          hitPlayer = p;
          break;
        }
      }
      if (hitPlayer) {
        this.onHitPlayer(hitPlayer);
        if (this.state !== "playing") return; // ソロ死亡/全滅で状態が変わったら以降の弾処理を中断
        continue; // 弾を消費（無敵or相方生存で継続）
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
        if (alive[i].group === alive[j].group) continue; // 同じ一斉射の弾は相殺しない（別射なら自弾同士でも相殺）
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

    // 地雷（設置要求の処理＋信管起爆）。デモはオートパイロットが設置するので入力は無視。
    if (!this.demo) for (let n = this.input.takeMines(); n > 0; n--) this.layMine();
    this.updateMines(dt);

    // クリア判定（敵を全滅）。ただし同フレームに自機が大破（dying等）した場合はクリアより死亡を優先する
    // （例：1つの爆発で自機と最後の敵が同時に倒れたケース。state が dying に変わっているので素通りさせない）。
    if (this.state === "playing" && !this.tutorial && this.enemies.length === 0) {
      playSound("clear", { volume: 0.7 }); // ステージクリア音
      if (this.onStageClear) {
        // キャンペーン：ステージ背景を残したままクリアポップアップ → 待機後に次へ（loopで処理）
        this.state = "stageclear";
        this.interTimer = STAGE_CLEAR_PAUSE;
        this.clearHealed = this.clearGrantsLife && this.gainLife(); // 5/10/15クリアで即+1（上限なら不可）
      } else {
        // 単体ステージ：そのまま最終リザルトへ
        this.enterCleared();
      }
    }

    // チュートリアル：このフレームの達成イベントでステップを進める。
    if (this.tutorial) {
      const moved = this.dist(tutFromX, tutFromY, this.pos.x, this.pos.y);
      this.tutAdvance(moved, tutFired, tutAimed);
    }
  }

  // 地雷を設置（最大 MAX_MINES）。外部ボタン(💣/E)からはローカル機が設置。
  layMine(): void {
    this.layMineFrom(this.players[this.localId]);
  }

  // 指定プレイヤーの位置に地雷を設置（プレイヤーの地雷は owner=null）。
  private layMineFrom(p: Player): void {
    if (this.mines.filter((m) => m.owner === null).length >= MAX_MINES) return;
    this.mines.push({ x: p.pos.x, y: p.pos.y, t: 0, owner: null, by: p.id });
    playSound("mine", { volume: 0.5 }); // 地雷設置音
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
    const hitPlayers = new Set<Player>(); // 爆風に巻き込まれた生存プレイヤー
    while (queue.length) {
      const m = this.mines[queue.pop()!];
      this.explosions.push({ x: m.x, y: m.y, t: 0, maxR: this.blastR, life: MINE_BLAST_LIFE });
      playSound("explosion", { volume: 0.6, throttleMs: 60 }); // 地雷爆発音（連鎖は間引き）
      // 1) 壊すブロックを「破壊前のタイル」で確定（手前の壁が奥を守る＝貫通させない）
      const bricks = this.collectBlastBricks(m.x, m.y);
      // 2) 戦車・連鎖も破壊前のタイルで判定（壊すブロックが遮蔽として機能）
      //    爆風内なら設置者本人も巻き込む（置いた直後に弾で起爆して無傷になる“ガード”悪用を防止）
      for (const p of this.players) {
        if (p.alive && this.inBlast(m.x, m.y, p.pos.x, p.pos.y)) hitPlayers.add(p);
      }
      this.enemies = this.enemies.filter((e) => {
        if (this.inBlast(m.x, m.y, e.x, e.y)) {
          e.hp--;
          if (e.hp <= 0) {
            this.markKill(e, m.by); // 撃破数（地雷を置いた人に帰属）＋大破演出＋バッテン印
            return false;
          }
          this.hitFx(e.x, e.y);
        }
        return true;
      });
      this.mines.forEach((o, j) => {
        if (!det.has(j) && this.inBlast(m.x, m.y, o.x, o.y)) {
          det.add(j);
          queue.push(j);
        }
      });
      // 爆風内の弾丸は誘爆させてその場で消す（壁の遮蔽は戦車と同条件で判定）
      this.bullets = this.bullets.filter((b) => {
        if (this.inBlast(m.x, m.y, b.x, b.y)) {
          this.hitFx(b.x, b.y);
          return false;
        }
        return true;
      });
      // 3) 最後にブロックを破壊（↑の判定には影響させない）
      for (const [c, r] of bricks) this.stage.tiles[r][c] = TILE.FLOOR;
      if (this.tutorial && bricks.length) this.tutBrickBroken = true; // 地雷ステップの達成
    }
    this.mines = this.mines.filter((_, j) => !det.has(j));
    for (const p of hitPlayers) this.onHitPlayer(p); // 巻き込まれたプレイヤーを処理（チュートリアルは無敵）
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

  // 指定プレイヤーの弾数を数える（同時発射上限の判定用）。毎回の filter による配列確保を避ける。
  private countPlayerBullets(id: number): number {
    let n = 0;
    for (const b of this.bullets) if (b.owner === id) n++;
    return n;
  }

  // 敵の当たり半径（タイプのサイズ倍率を反映）。
  private er(e: Enemy): number {
    return TANK_RADIUS * (e.type.scale ?? 1);
  }

  // dir 方向に撃つと、自機へ届く手前で別の敵タンク（味方の敵）に当たるか。
  // 当たるなら true＝同士討ちになるので発射を見送る。直射・バンク両対応。
  private allyInLineOfFire(self: Enemy, dir: { x: number; y: number }): boolean {
    const friends: { x: number; y: number; r: number }[] = [];
    for (const o of this.enemies) {
      if (o !== self) friends.push({ x: o.x, y: o.y, r: this.er(o) });
    }
    if (friends.length === 0) return false;
    const { cell, cols, rows } = this.stage.grid;
    const maxDist = (cols * cell + rows * cell) * (self.type.bounces + 1);
    return friendlyBlocksPath(
      this.stage,
      self.x,
      self.y,
      dir.x,
      dir.y,
      this.pos.x,
      this.pos.y,
      self.type.bounces,
      maxDist,
      friends,
    );
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

  // 倒したプレイヤー(id)の撃破マップ（遅延生成）。id<0(敵)は帰属しない。
  private killMap(id: number): Record<string, number> {
    return (this.killsBy[id] ??= {});
  }

  // ローカル機自身の撃破マップ（表示用）。
  private myKills(): Record<string, number> {
    return this.killsBy[this.localId] ?? {};
  }

  // 敵の撃破を記録（撃破数の集計＋大破演出＋やられた座標に白いバッテン印）。
  // killerId＝倒したプレイヤーID（弾の owner／地雷の by）。敵の巻き添え(<0)はどのプレイヤーにも計上しない。
  private markKill(e: Enemy, killerId: number): void {
    if (killerId >= 0) {
      const m = this.killMap(killerId);
      m[e.type.key] = (m[e.type.key] ?? 0) + 1;
    }
    this.spawnDeathFx(e.x, e.y); // 敵も大破演出
    this.deathMarks.push({ x: e.x, y: e.y, color: "#ffffff" });
    playSound("explosion", { volume: 0.6, throttleMs: 60 }); // 戦車大破音（爆発と同じ）
  }

  // 指定プレイヤーが dir 方向へ発射（owner=そのプレイヤーID）。ソロ/ホスト共通。
  private fireFrom(p: Player, dir: { x: number; y: number }): void {
    this.bulletGroup++;
    this.spawnBullet(p.pos.x, p.pos.y, dir, p.id);
    p.facing = Math.atan2(dir.y, dir.x);
    p.fireStun = FIRE_STUN;
  }

  // owner: 0..=プレイヤーID / -1=敵。砲口（半径の外側）から発射する。弾速・反射回数は指定可。
  private spawnBullet(
    ox: number,
    oy: number,
    dir: { x: number; y: number },
    owner: number,
    speed = BULLET_SPEED,
    bounces = MAX_BOUNCES,
    originR = TANK_RADIUS,
  ): void {
    const off = originR + BULLET_RADIUS + 2; // 機体の外側から発射（大型機の自滅防止）
    this.bullets.push({
      x: ox + dir.x * off,
      y: oy + dir.y * off,
      vx: dir.x * speed,
      vy: dir.y * speed,
      bounces,
      owner,
      age: 0,
      group: this.bulletGroup,
    });
    playSound("shot", { volume: 0.15, throttleMs: 45 }); // 発射音（音量控えめ・同時多発は間引き）
  }

  // 行動軸をタイプの性格に応じた重みで切り替える。
  private pickBehavior(e: Enemy): void {
    const r = Math.random();
    if (e.type.behavior === "chaser") e.behavior = r < 0.6 ? "combat" : "wander"; // 追跡（ほどほど）
    else if (e.type.behavior === "approach") e.behavior = r < 0.8 ? "combat" : "wander";
    else if (e.type.behavior === "kite") e.behavior = r < 0.5 ? "retreat" : r < 0.9 ? "wander" : "combat";
    else e.behavior = r < 0.6 ? "combat" : r < 0.9 ? "wander" : "retreat"; // balanced
    e.behaviorTimer = BEHAVIOR_MIN + Math.random() * (BEHAVIOR_MAX - BEHAVIOR_MIN);
    if (e.behavior === "wander") this.pickWanderDest(e);
  }

  // 徘徊の目的地（ランダムな床セル）を選ぶ。
  private pickWanderDest(e: Enemy): void {
    const { cols, rows } = this.stage.grid;
    for (let i = 0; i < 20; i++) {
      const c = Math.floor(Math.random() * cols);
      const r = Math.floor(Math.random() * rows);
      if (!isSolidCell(this.stage, c, r)) {
        e.wdCol = c;
        e.wdRow = r;
        return;
      }
    }
    e.wdCol = -1;
  }

  // 戦車らしい移動（プレイヤーと同じ旋回モデル）。車体の向き(heading)を目標方向へ
  // 旋回レート上限で回し、前後どちらか近い軸へ寄せて、整列していれば（or 移動継続中なら）スライド前進。
  // 急な方向転換はしづらく、壁では擦りながら進む（詰まらない）。
  private driveTank(
    x: number,
    y: number,
    heading: number,
    desiredAng: number,
    speed: number,
    dt: number,
    wasMoving: boolean,
    blocked: (px: number, py: number) => boolean,
  ): { x: number; y: number; heading: number; moved: boolean } {
    // 共通の旋回モデルで車体向きを目標へ寄せる（自機の移動と同一）。
    const turn = turnToward(heading, desiredAng, dt);
    heading = turn.heading;
    let moved = false;
    if (wasMoving || turn.aligned) {
      const step = speed * dt;
      const slid = slide(x, y, x + Math.cos(turn.moveDir) * step, y + Math.sin(turn.moveDir) * step, blocked);
      if (Math.hypot(slid.x - x, slid.y - y) > step * 0.15) {
        x = slid.x;
        y = slid.y;
        moved = true;
      }
    }
    return { x, y, heading, moved };
  }

  // プレイヤーの弾(b)が、反射も込みで敵(e)の危険圏(danger)に入るかを予測。
  // 入るなら、その接近時点の弾の進行方向(ux,uy)・接近位置(px,py)・到達秒(t)を返す。来なければ null。
  private predictBulletApproach(
    b: Bullet,
    e: Enemy,
    danger: number,
  ): { ux: number; uy: number; px: number; py: number; t: number } | null {
    const cell = this.stage.grid.cell;
    const speed = Math.hypot(b.vx, b.vy) || 1;
    // 速度は単位ベクトルに正規化し、dt=step で進める（実弾と同じ反射物理を共有）。
    const ray: RayStep = { x: b.x, y: b.y, vx: b.vx / speed, vy: b.vy / speed, bounces: b.bounces };
    const step = cell * 0.2;
    const horizon = speed * 1.5; // 約1.5秒先まで警戒（シルバーは過敏に避ける）
    let traveled = 0;
    const guard = Math.ceil(horizon / step) + 8;
    for (let s = 0; s < guard && traveled < horizon; s++) {
      if (Math.hypot(ray.x - e.x, ray.y - e.y) < danger) {
        return { ux: ray.vx, uy: ray.vy, px: ray.x, py: ray.y, t: traveled / speed };
      }
      const ox = ray.x;
      const oy = ray.y;
      if (!stepReflect(this.stage, ray, step)) return null; // 反射しきって消える＝以降は脅威にならない
      traveled += Math.hypot(ray.x - ox, ray.y - oy);
    }
    return null;
  }

  // 高知能タイプ：最も差し迫ったプレイヤー弾を弾道に対し直角へかわす。回避移動したら true。
  private computeDodge(e: Enemy, dt: number): boolean {
    const danger = this.er(e) + BULLET_RADIUS + 34; // 危険半径（広め＝過敏に避ける）
    let best: { ux: number; uy: number; px: number; py: number; t: number } | null = null;
    for (const b of this.bullets) {
      if (b.owner < 0) continue; // プレイヤーの弾だけ警戒（敵弾は無視）
      const th = this.predictBulletApproach(b, e, danger);
      if (th && (!best || th.t < best.t)) best = th;
    }
    if (!best) return false; // 脅威なし＝通常行動へ
    // 弾の進行方向に直角の2方向のうち、敵がいる側（＝線から離れる側）へ逃げる
    const px = -best.uy;
    const py = best.ux;
    const side = (e.x - best.px) * px + (e.y - best.py) * py;
    const evadeAng = Math.atan2(side >= 0 ? py : -py, side >= 0 ? px : -px);
    // プレイヤーと同じ旋回モデルで回避（回避速度は等速）。壁際でもスライドで擦りながら避ける。
    const blocked = (qx: number, qy: number): boolean => this.moverBlocked(qx, qy, e);
    const r = this.driveTank(e.x, e.y, e.bodyAngle, evadeAng, e.type.speed, dt, e.moving, blocked);
    e.x = r.x;
    e.y = r.y;
    e.bodyAngle = r.heading;
    e.moving = r.moved;
    if (r.moved) {
      this.enemyMoving = true;
      if (this.dist(e.x, e.y, e.tx, e.ty) >= TRACK_GAP) {
        this.addTrack(e.x, e.y, e.bodyAngle);
        e.tx = e.x;
        e.ty = e.y;
      }
    }
    // 脅威がある間は弾避けを最優先（通常移動へは戻さない＝壁際でのかくつき防止）
    return true;
  }

  // 敵が狙うプレイヤー＝最も近い「生存」プレイヤー（ソロ=P1。Co-opで死者は除外）。
  private enemyTarget(e: Enemy): Player {
    let best = this.players[0];
    let bd = Infinity;
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = this.dist(e.x, e.y, p.pos.x, p.pos.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best; // 全員死亡時は players[0]（その場合 updateEnemies は呼ばれない想定＝安全側）
  }

  private updateEnemies(dt: number): void {
    this.enemyMoving = false; // 毎フレーム集計し直す（走行音用）
    for (const e of this.enemies) {
      const t = e.type;
      const tgt = this.enemyTarget(e); // 最も近い生存プレイヤーを標的にする（Co-op）
      const near = this.dist(e.x, e.y, tgt.pos.x, tgt.pos.y) < ENEMY_NEAR;

      // 透明タイプ：CLOAK_TIME 経過の瞬間に煙を出して消える
      const prevAge = e.age;
      e.age += dt;
      if (t.invisible && prevAge < CLOAK_TIME && e.age >= CLOAK_TIME) {
        this.explosions.push({ x: e.x, y: e.y, t: 0, maxR: this.er(e) * 1.8, life: 0.6, color: "rgba(150,152,160,0.8)" });
      }

      if (e.fireStun > 0) e.fireStun -= dt; // 発射直後は停止
      // 移動（speed>0 かつ発射停止中でない）：行動軸＝戦闘/退避/無目的をランダム切替
      if (t.speed > 0 && e.fireStun <= 0) {
        // シルバー等：プレイヤーの弾（反射軌道含む）を予測回避。回避したフレームは通常移動しない
        const dodged = t.dodge ? this.computeDodge(e, dt) : false;
        if (!dodged) {
        e.behaviorTimer -= dt;
        if (e.behaviorTimer <= 0) this.pickBehavior(e);
        const dx = tgt.pos.x - e.x;
        const dy = tgt.pos.y - e.y;
        const d = Math.hypot(dx, dy);
        let behavior = e.behavior;
        const defensiveType = e.type.behavior === "balanced" || e.type.behavior === "kite";
        if (behavior === "combat" && defensiveType) {
          // 壁越しには突っ込まない：射線が壁で切れていて、かなり近くなければ守備的（退避）に
          // ※攻撃的タイプ(approach/chaser)は退かず、回り込みで追い続ける
          if (d > ENEMY_CLOSE && !lineClear(this.stage, e.x, e.y, tgt.pos.x, tgt.pos.y)) behavior = "retreat";
        } else if (behavior === "retreat" && d > ENEMY_NEAR * 1.5) {
          behavior = "wander"; // 遠すぎる退避は徘徊に（端へ逃げ続けない）
        }
        const cell = this.stage.grid.cell;
        const ecol = Math.floor(e.x / cell);
        const erow = Math.floor(e.y / cell);
        // 行動に応じた目的セル（戦闘=自機 / 退避=離れた床 / 徘徊=ランダム床）
        let tcol: number;
        let trow: number;
        // 角待ち（自機が一定時間動かない）なら、円内でも詰める／回り込むのを許可
        const camping = tgt.idleTime >= ENEMY_STANDOFF_BREAK;
        if (d < ENEMY_STANDOFF && !camping) {
          // プレイヤー周囲の円内：詰めない・止まらない・厳密な距離保持もしない＝適当に徘徊する
          if (e.wdCol < 0 || (ecol === e.wdCol && erow === e.wdRow)) this.pickWanderDest(e);
          tcol = e.wdCol;
          trow = e.wdRow;
        } else if (behavior === "retreat") {
          const m = d || 1;
          tcol = Math.max(0, Math.min(this.stage.grid.cols - 1, Math.floor((e.x - (dx / m) * cell * 4) / cell)));
          trow = Math.max(0, Math.min(this.stage.grid.rows - 1, Math.floor((e.y - (dy / m) * cell * 4) / cell)));
        } else if (behavior === "wander") {
          if (e.wdCol < 0 || (ecol === e.wdCol && erow === e.wdRow)) this.pickWanderDest(e);
          tcol = e.wdCol;
          trow = e.wdRow;
        } else {
          tcol = Math.floor(tgt.pos.x / cell);
          trow = Math.floor(tgt.pos.y / cell);
        }
        // BFSで目的セルへの「次の一歩」を求めて回り込む（0.3秒ごと再計算）＝壁を正確に避ける
        e.pathTimer -= dt;
        if (e.pathTimer <= 0) {
          const n = tcol >= 0 ? nextStepToward(this.stage, ecol, erow, tcol, trow) : null;
          e.wpCol = n ? n.col : -1;
          e.wpRow = n ? n.row : -1;
          e.pathTimer = 0.3;
        }
        let desired: number;
        if (e.wpCol >= 0) {
          desired = Math.atan2((e.wpRow + 0.5) * cell - e.y, (e.wpCol + 0.5) * cell - e.x);
        } else if (behavior === "retreat") {
          desired = Math.atan2(-dy, -dx);
        } else {
          desired = Math.atan2(dy, dx);
        }

        // プレイヤーと同じ旋回モデルで移動（急な方向転換はしづらい）。壁ではスライドで擦りながら進む。
        const blocked = (px: number, py: number): boolean => this.moverBlocked(px, py, e);
        const r = this.driveTank(e.x, e.y, e.bodyAngle, desired, t.speed, dt, e.moving, blocked);
        e.x = r.x;
        e.y = r.y;
        e.bodyAngle = r.heading; // 止まっていても回頭は進む
        const moved = r.moved;
        e.moving = moved;
        if (!moved && behavior === "wander") this.pickWanderDest(e);
        if (moved && this.dist(e.x, e.y, e.tx, e.ty) >= TRACK_GAP) {
          this.addTrack(e.x, e.y, e.bodyAngle); // 履帯は車体向きで刻む
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
            this.pickWanderDest(e);
            e.pathTimer = 0; // すぐ経路再計算
            e.behaviorTimer = BEHAVIOR_MIN + Math.random() * (BEHAVIOR_MAX - BEHAVIOR_MIN);
            e.stuckTimer = 0;
          }
        } else {
          e.stuckCol = cc;
          e.stuckRow = cr;
          e.stuckTimer = 0;
        }
        if (moved) {
          e.facing = e.bodyAngle; // 砲塔も普段は車体向き（射線が通れば下で自機へ）
          this.enemyMoving = true; // 走行音：敵が動いている
        }
        } // end if(!dodged)
      }
      // 射線が通っている時だけ砲塔を自機へ向ける（射撃の構え）
      if (lineClear(this.stage, e.x, e.y, tgt.pos.x, tgt.pos.y)) {
        e.facing = Math.atan2(tgt.pos.y - e.y, tgt.pos.x - e.x);
      }

      // 射撃：自機が近いほど発射間隔を短く。タイプ設定（バンク/精度/弾速/反射/連射）に従う
      const fireInterval = near ? t.fireInterval * NEAR_FIRE_MULT : t.fireInterval;
      e.cd -= dt;
      if (e.cd <= 0 && e.burstLeft <= 0) {
        const dir = computeAimDir(this.stage, e.x, e.y, tgt.pos.x, tgt.pos.y, t.bank, t.bounces);
        if (dir && !this.allyInLineOfFire(e, dir)) {
          if (t.salvo && t.bullets > 1) {
            // 砲台複数門：扇状に同時発射（同じグループ＝互いに相殺しない）
            this.bulletGroup++;
            const baseAngle = Math.atan2(dir.y, dir.x);
            const spread = 0.14;
            for (let i = 0; i < t.bullets; i++) {
              const a = baseAngle + (i - (t.bullets - 1) / 2) * spread;
              this.spawnBullet(e.x, e.y, { x: Math.cos(a), y: Math.sin(a) }, OWNER_ENEMY, t.bulletSpeed, t.bounces, this.er(e));
            }
            e.facing = baseAngle;
            e.fireStun = FIRE_STUN;
            e.cd = fireInterval;
          } else {
            // 逐次連射：発数は毎回ランダム（1〜最大）。自機が近いほど最大に寄る
            let n = 1;
            const p = near ? 0.75 : 0.35;
            while (n < t.bullets && Math.random() < p) n++;
            e.burstLeft = n;
            e.burstTimer = 0;
          }
        } else {
          e.cd = 0.3; // 射線が無いときは少し待って再試行
        }
      }
      // 逐次連射：先に出した弾に当たらない最短間隔で1発ずつ
      if (e.burstLeft > 0) {
        e.burstTimer -= dt;
        if (e.burstTimer <= 0) {
          let dir = computeAimDir(this.stage, e.x, e.y, tgt.pos.x, tgt.pos.y, t.bank, t.bounces);
          if (dir && !this.allyInLineOfFire(e, dir)) {
            if (t.aimJitter > 0) dir = rotate(dir, (Math.random() * 2 - 1) * t.aimJitter);
            this.bulletGroup++;
            this.spawnBullet(e.x, e.y, dir, OWNER_ENEMY, t.bulletSpeed, t.bounces, this.er(e));
            e.facing = Math.atan2(dir.y, dir.x);
            e.fireStun = FIRE_STUN;
            e.burstLeft--;
            e.burstTimer = Math.max(BURST_GAP, (2 * BULLET_RADIUS + 4) / t.bulletSpeed); // 連射間隔
            if (e.burstLeft <= 0) e.cd = fireInterval;
          } else {
            e.burstLeft = 0; // 射線が切れたら連射中断
            e.cd = 0.3;
          }
        }
      }

      // 地雷を置くタイプ：上限まで一定間隔で設置
      if (t.maxMines > 0) {
        e.mineCd -= dt;
        if (e.mineCd <= 0) {
          if (this.mines.filter((m) => m.owner === e).length < t.maxMines) {
            this.mines.push({ x: e.x, y: e.y, t: 0, owner: e, by: -1 });
            playSound("mine", { volume: 0.35, throttleMs: 120 }); // 敵の地雷設置音（控えめ）
            e.mineCd = ENEMY_MINE_INTERVAL;
          } else {
            e.mineCd = 1.0; // 満杯なら少し待つ
          }
        }
      }
    }
  }

  // プレイヤー p が被弾したときの処理。ソロ＝従来の残機/リスポーン、Co-op＝待機（全滅でやり直し）。
  private onHitPlayer(p: Player): void {
    if (this.tutorial) return; // チュートリアルは無敵
    if (this.coopRole === "host") this.killPlayer(p);
    else this.onPlayerDeath(); // ソロ（p は必ず P1）
  }

  // Co-op：p を待機（観戦）にする。全員やられたら全滅演出→やり直しへ。
  private killPlayer(p: Player): void {
    if (!p.alive) return;
    p.alive = false;
    this.spawnDeathFx(p.pos.x, p.pos.y);
    this.deathMarks.push({ x: p.pos.x, y: p.pos.y, color: p.id === 0 ? COLORS.p1 : COLORS.p2 });
    playSound("explosion", { volume: 0.6, throttleMs: 60 });
    if (this.players.some((q) => q.alive)) {
      playSound("miss", { volume: 0.7 }); // 相方は生存＝ミス音
    } else {
      this.coopWipe(); // 全滅
    }
  }

  // Co-op：全滅演出に入り、DEATH_FX 後にステージを最初からやり直す（loop で処理）。
  private coopWipe(): void {
    stopBgm();
    playSound("gameover", { volume: 0.7 });
    this.coopWiping = true;
    this.pendingGameOver = false;
    this.state = "dying";
    this.interTimer = DEATH_FX;
  }

  private onPlayerDeath(): void {
    this.lives--;
    this.spawnDeathFx(this.pos.x, this.pos.y); // 自機が大破する演出
    playSound("explosion", { volume: 0.6, throttleMs: 60 }); // 自機の大破音（戦車大破＝爆発と共用）
    if (this.lives > 0) playSound("miss", { volume: 0.7 }); // 被弾ミス音（残機が尽きる死＝ゲームオーバーでは鳴らさない）
    stopBgm(); // 被弾でBGM停止（復活時に頭から再開）
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

  // HPが残る敵に当たった時の小さなヒット表示。
  private hitFx(x: number, y: number): void {
    this.explosions.push({ x, y, t: 0, maxR: TANK_RADIUS, life: 0.18 });
  }

  private ageExplosions(dt: number): void {
    for (const ex of this.explosions) ex.t += dt;
    this.explosions = this.explosions.filter((ex) => ex.t < ex.life);
  }

  // 自機だけリスポーンする。倒した敵は復活させないが、生き残った敵は定位置(home)へ戻す。
  // 全プレイヤー（ソロ=P1 / Co-op=P1・P2）を各自の初期位置・向きに戻す。
  private resetPlayersToSpawn(): void {
    for (const p of this.players) {
      p.pos = { ...p.spawn };
      p.trackFrom = { ...p.spawn };
      p.facing = -Math.PI / 2;
      p.heading = -Math.PI / 2;
      p.wasMoving = false;
      p.alive = true;
    }
  }

  private respawnPlayer(): void {
    this.resetPlayersToSpawn(); // P1・P2 とも初期位置へ
    this.bullets = [];
    this.mines = [];
    this.explosions = [];
    this.tracks = []; // 轍は被弾でリセット（継続しない）。バッテン印は維持
    this.tracksGen++; // ゲストにも轍クリアを伝える
    for (const e of this.enemies) {
      e.x = e.hx;
      e.y = e.hy;
      e.tx = e.hx;
      e.ty = e.hy;
      if (e.type.key !== "boss") e.hp = e.type.hp; // 生き残った敵のHPは全回復。ただしボスは削った体力を引き継ぐ
      e.age = 0; // 透明タイプは再び1秒だけ見える
      e.cd = ENEMY_OPENING_DELAY + Math.random() * 0.8; // 復活直後も少し撃たない猶予
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
    this.tracksGen++; // ゲストにも轍クリアを伝える
    this.deathMarks = [];
    this.resetPlayersToSpawn(); // P1・P2 とも初期位置へ
  }

  // 最初からやり直す（残機リセット）。クリア／ゲームオーバー後に呼ぶ。
  restart(): void {
    this.lives = SOLO_LIVES;
    this.killsBy = [];
    startBgm(0.2); // 頭からBGM再生
    this.resetStage();
    this.state = "playing";
  }

  // 移動型の敵が進めない位置か：壁／自機／他の戦車と重なる。
  private moverBlocked(px: number, py: number, self: Enemy): boolean {
    const rs = this.er(self);
    if (circleHitsSolid(this.stage, px, py, rs)) return true;
    if (this.dist(px, py, this.pos.x, this.pos.y) < rs + TANK_RADIUS) return true;
    if (this.enemies.some((o) => o !== self && this.dist(px, py, o.x, o.y) < rs + this.er(o))) return true;
    // 自分が置いた地雷の爆風圏には踏み込まない（外へ離れる方向は許可）
    for (const m of this.mines) {
      if (m.owner !== self) continue;
      const dCand = this.dist(px, py, m.x, m.y);
      if (dCand < this.blastR && dCand < this.dist(self.x, self.y, m.x, m.y)) return true;
    }
    return false;
  }

  private hitsEnemy(px: number, py: number): boolean {
    for (const e of this.enemies) {
      const minDist = TANK_RADIUS + this.er(e);
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
    // 走行音：自機または敵が1体でも動いていれば鳴らす
    setLoop("engine", this.state === "playing" && (this.wasMoving || this.enemyMoving), 0.15); // 走行音（控えめ）
    if (this.immersive) {
      // 没入時はキャンバスがアリーナより大きい＝黒帯を塗ってからアリーナを中央に描く
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    // ワールドは scale×dpr＋オフセット×dpr で内部解像度いっぱいに描く（高精細）
    const s = this.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, this.offsetX * this.dpr, this.offsetY * this.dpr);
    renderMap(ctx, this.stage);
    this.drawTracks(ctx);
    for (const dm of this.deathMarks) drawCross(ctx, dm.x, dm.y, dm.color);
    for (const m of this.mines) drawMine(ctx, m.x, m.y, m.t);
    for (const e of this.enemies) {
      if (e.type.invisible && e.age >= CLOAK_TIME) continue; // 透明化中は描かない（轍・弾で推測）
      drawTank(ctx, e.x, e.y, e.type.color, e.bodyAngle, e.facing, this.er(e));
    }
    // 照準線は各自の操作機（生存中のみ）に描く。ゲストも自機(P2)の予測線を出す（§12-d）。
    if (this.players[this.localId].alive) this.drawAimLine(ctx);
    // プレイヤー戦車（ソロ=1台 / Co-op=2台）。待機(alive=false)は描かない。
    // ソロのみ：大破演出中/ゲームオーバー後は自機を隠す（破壊された＝従来挙動）。
    // Co-op では state を共有するため localId 基準の隠しは使わず alive で判定する（②-3で死＝alive=false）。
    const hideLocalDeath = this.coopRole === null && (this.state === "dying" || this.state === "gameover");
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.id === this.localId && hideLocalDeath) continue;
      const col = p.id === 0 ? COLORS.p1 : COLORS.p2;
      drawTank(ctx, p.pos.x, p.pos.y, col, p.heading, p.facing);
      if (this.coopRole) this.drawNameTag(ctx, p, col); // Co-op：戦車の上に名前
    }
    for (const b of this.bullets) {
      drawBullet(ctx, b.x, b.y, Math.atan2(b.vy, b.vx), b.owner >= 0 ? COLORS.bulletP : COLORS.bulletE);
    }
    for (const ex of this.explosions) drawExplosion(ctx, ex.x, ex.y, ex.t / ex.life, ex.maxR, ex.color);

    // HUD/操作系は論理px座標（×dpr）で描く＝高精細かつUIサイズは一定
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.demo) {
      // デモ（タイトル背景）では操作系・HUD・各種ポップアップを描かない
      // 操作UI（PCカーソル/スティック）はローカル機が生存中のみ（死亡=待機中は消す）
      if (this.players[this.localId].alive) this.input.drawSticks(ctx);
      this.drawHud(ctx);
    }
  }

  // 白文字＋暗い縁取りで、明るい床・暗い黒帯どちらでも視認できるHUDテキスト。
  private hudText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, x, y);
  }

  // Co-op：戦車の上に表示名を描く（ワールド座標系。画面上で一定サイズになるよう scale で割る）。
  private drawNameTag(ctx: CanvasRenderingContext2D, p: Player, col: string): void {
    const name = this.playerName(p.id);
    const fs = 13 / this.scale;
    ctx.save();
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineJoin = "round";
    ctx.lineWidth = 4 / this.scale;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.fillStyle = col;
    const y = p.pos.y - TANK_RADIUS - 5 / this.scale;
    ctx.strokeText(name, p.pos.x, y);
    ctx.fillText(name, p.pos.x, y);
    ctx.restore();
  }

  // 残機（自機アイコン×数）・敵数・ステージ番号・状態。
  // 没入時はアリーナの角に寄せ（黒帯に乗らない）、右上はギアと重なるので情報は左側にまとめる。
  private drawHud(ctx: CanvasRenderingContext2D): void {
    const ox = this.immersive ? this.offsetX : 0;
    const oy = this.immersive ? this.offsetY : 0;
    const left = ox;
    const iy = 22 + oy;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let enemyX: number;
    if (this.coopRole) {
      // Co-op：残機ではなく P1/P2 の生存表示。やられた側はアイコンを消す。
      if (this.players[0]?.alive) drawTankIcon(ctx, left + 20, iy, COLORS.p1);
      if (this.players[1]?.alive) drawTankIcon(ctx, left + 44, iy, COLORS.p2);
      enemyX = left + 66;
    } else {
      drawTankIcon(ctx, left + 20, iy, COLORS.p1);
      ctx.font = "bold 18px sans-serif";
      this.hudText(ctx, `× ${this.lives}`, left + 38, iy);
      enemyX = left + 92;
    }
    ctx.font = "bold 14px sans-serif";
    this.hudText(ctx, `敵 ${this.enemies.length}`, enemyX, iy);
    if (this.stageLabel) {
      if (this.immersive) {
        // 没入：右上はギアがあるので、敵数の右隣（左寄せ）に置く
        ctx.font = "bold 14px sans-serif";
        this.hudText(ctx, this.stageLabel, left + 150, iy);
      } else {
        ctx.textAlign = "right";
        ctx.font = "bold 16px sans-serif";
        this.hudText(ctx, this.stageLabel, this.lw() - 10, iy);
      }
    }

    this.drawBossBar(ctx); // ボスがいれば体力バー

    if (this.tutorial && (this.state === "playing" || this.tutDoneTimer > 0)) this.drawTutorial(ctx);

    if (this.state === "playing" || this.state === "dying") return; // 大破演出中は中央表示なし
    if (this.state === "intro") {
      this.drawIntro(ctx);
      return;
    }
    if (this.state === "respawning") {
      this.drawMiss(ctx);
      return;
    }
    if (this.state === "stageclear") {
      this.drawStageClear(ctx);
      return;
    }
    if (this.state === "gameover") {
      this.drawResult(ctx, "GAME OVER", "#ff8080");
      return;
    }
    // cleared
    this.drawResult(ctx, "CLEAR!", "#7CFC9B");
  }

  // チュートリアルの操作説明（端末でラベルを出し分け。BasicDesign §15-d）。
  private tutMessage(): string {
    const pc = this.input.isPc();
    switch (this.tutStep) {
      case 0:
        return pc ? "WASD / 矢印キーで動いてみよう" : "画面の左半分をドラッグして動こう";
      case 1:
        return pc ? "クリックで弾を撃ってみよう" : "画面の右半分を軽くタップして撃とう";
      case 2:
        return pc ? "ねらいを定めてクリックで撃とう" : "右半分をドラッグ→指を離して、ねらって撃とう";
      case 3:
        return pc ? "E キーか 💣 で地雷を置いて、茶色い壁を壊そう" : "💣 ボタンで地雷を置いて、茶色い壁を壊そう";
      case 4:
        return "仕上げ：敵の戦車を撃破しよう！";
      default:
        return "";
    }
  }

  // チュートリアルの進行バナー（上部中央）／完了表示（中央）。
  private drawTutorial(ctx: CanvasRenderingContext2D): void {
    const cx = this.lw() / 2;
    ctx.textAlign = "center";
    if (this.tutDoneTimer > 0) {
      ctx.font = "bold 30px sans-serif";
      this.hudText(ctx, "チュートリアル完了！", cx, this.lh() / 2);
      return;
    }
    const y = (this.immersive ? this.offsetY : 0) + 50;
    ctx.font = "bold 13px sans-serif";
    this.hudText(ctx, `STEP ${this.tutStep + 1} / 5`, cx, y);
    ctx.font = "bold 18px sans-serif";
    this.hudText(ctx, this.tutMessage(), cx, y + 22);
  }

  // ステージクリアのポップアップ（背景のステージは残したまま中央にパネル）。
  private drawStageClear(ctx: CanvasRenderingContext2D): void {
    const cx = this.lw() / 2;
    const cy = this.lh() / 2;
    const pw = Math.min(360, this.lw() * 0.8);
    const ph = this.clearHealed ? 172 : 130; // +1回復の行ぶん広げる
    // パネル（半透明・角丸風）
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(cx - pw / 2, cy - ph / 2, pw, ph);
    ctx.strokeStyle = "#7CFC9B";
    ctx.lineWidth = 3;
    ctx.strokeRect(cx - pw / 2, cy - ph / 2, pw, ph);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const titleY = this.clearHealed ? cy - 44 : cy - 28;
    const killsY = this.clearHealed ? cy : cy + 18;
    ctx.fillStyle = "#7CFC9B";
    ctx.font = "bold 30px sans-serif";
    ctx.fillText("ステージクリア！", cx, titleY);

    const totalKills = Object.values(this.myKills()).reduce((a, b) => a + b, 0);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(`総撃破数  ${totalKills}`, cx, killsY);

    if (this.clearHealed) {
      ctx.fillStyle = "#f0a93b";
      ctx.font = "bold 22px sans-serif";
      ctx.fillText("残機 +1 回復！", cx, cy + 40);
    }
  }

  // ボスの体力バー（画面上部・中央）。ボスが複数いれば縦に並べる。
  private drawBossBar(ctx: CanvasRenderingContext2D): void {
    if (this.state !== "playing" && this.state !== "dying") return; // 戦闘中のみ表示
    const bosses = this.enemies.filter((e) => e.type.key === "boss");
    if (bosses.length === 0) return;
    const cw = this.lw();
    const bw = Math.min(420, cw * 0.7); // バー幅
    const bh = 16;
    const x = (cw - bw) / 2;
    let y = 44;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const b of bosses) {
      const ratio = Math.max(0, Math.min(1, b.hp / b.type.hp));
      // 枠＋背景
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x - 2, y - 2, bw + 4, bh + 4);
      ctx.fillStyle = "#3a3a3a";
      ctx.fillRect(x, y, bw, bh);
      // 残量（緑→黄→赤）
      ctx.fillStyle = ratio > 0.5 ? "#5fd35f" : ratio > 0.25 ? "#e8c020" : "#e74c3c";
      ctx.fillRect(x, y, bw * ratio, bh);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, bw, bh);
      // ラベル
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText(`BOSS  ${b.hp} / ${b.type.hp}`, cw / 2, y + bh / 2);
      y += bh + 8;
    }
  }

  // クリア／ゲームオーバー時のリザルト：色別の戦車アイコン×撃破数。
  private drawResult(ctx: CanvasRenderingContext2D, title: string, titleColor: string): void {
    const cx = this.lw() / 2;
    const cy = this.lh() / 2;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, this.lw(), this.lh());

    ctx.fillStyle = titleColor;
    ctx.font = "bold 40px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, cx, cy - 78);

    ctx.fillStyle = "#fff";
    ctx.font = "18px sans-serif";
    ctx.fillText("撃破数", cx, cy - 34);

    const mk = this.myKills();
    const entries = Object.keys(mk).map((k) => ({ color: ENEMY_TYPES[k].color, count: mk[k] }));
    // 種類が5を超えたら2段に分けて表示（横あふれ防止）
    const twoRows = entries.length > 5;
    const perRow = twoRows ? Math.ceil(entries.length / 2) : entries.length;
    const rows = twoRows ? [entries.slice(0, perRow), entries.slice(perRow)] : [entries];
    const rowYs = twoRows ? [cy - 2, cy + 40] : [cy + 10];
    rows.forEach((row, ri) => {
      if (row.length === 0) return;
      const ew = Math.min(150, (this.lw() * 0.92) / row.length);
      const iconR = Math.max(10, Math.min(16, ew * 0.12));
      const y = rowYs[ri];
      let x = cx - (row.length * ew) / 2 + ew / 2;
      ctx.font = `${Math.round(iconR * 1.4)}px sans-serif`;
      for (const e of row) {
        drawTankIcon(ctx, x - ew * 0.3, y, e.color, iconR);
        ctx.fillStyle = "#fff";
        ctx.textAlign = "left";
        ctx.fillText(`× ${e.count}`, x - ew * 0.3 + iconR + 6, y);
        x += ew;
      }
    });

    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "16px sans-serif";
    ctx.fillText("R キー / リスタートボタンで再挑戦", cx, cy + (twoRows ? 84 : 70));
  }

  // 被弾の区切り画面：「ミス！」＋ 残機（自機アイコン×数）。
  private drawMiss(ctx: CanvasRenderingContext2D): void {
    const cx = this.lw() / 2;
    const cy = this.lh() / 2;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, cy - 56, this.lw(), 112);

    ctx.fillStyle = "#ffd23a";
    ctx.font = "bold 34px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ミス！", cx, cy - 20);

    drawTankIcon(ctx, cx - 34, cy + 20, COLORS.p1, 16);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.font = "22px sans-serif";
    ctx.fillText(`× ${this.lives}`, cx - 4, cy + 20);

    ctx.textAlign = "center";
    ctx.fillStyle = "#ccc";
    ctx.font = "13px sans-serif";
    ctx.fillText("まもなく再開…", cx, cy + 46);
  }

  // ステージ開始の区切り画面：ステージ名・出現する敵（色×数）・残機。
  private drawIntro(ctx: CanvasRenderingContext2D): void {
    const cx = this.lw() / 2;
    const cy = this.lh() / 2;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, this.lw(), this.lh());

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 40px sans-serif";
    ctx.fillText(this.stageLabel, cx, cy - 70);

    // 出現する敵の総数（敵戦車 × 数）
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "26px sans-serif";
    ctx.fillText(`敵戦車 × ${this.enemies.length}`, cx, cy);

    // 5ステージごとの残機回復の告知
    if (this.introHealed) {
      ctx.fillStyle = "#7CFC9B";
      ctx.font = "bold 22px sans-serif";
      ctx.fillText("残機 +1 回復！", cx, cy + 28);
    }

    // 残機（自機アイコン×数）
    drawTankIcon(ctx, cx - 34, cy + 54, COLORS.p1, 16);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.font = "22px sans-serif";
    ctx.fillText(`× ${this.lives}`, cx - 4, cy + 54);

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
    const d = this.playerAimDir();
    if (!d) return;
    const STEP_LEN = 6;
    const MAX_LEN = 900;
    const cell = this.stage.grid.cell;
    let ex = this.pos.x;
    let ey = this.pos.y;
    for (let t = TANK_RADIUS; t <= MAX_LEN; t += STEP_LEN) {
      const px = this.pos.x + d.x * t;
      const py = this.pos.y + d.y * t;
      ex = px;
      ey = py;
      // 壁（鋼/壊せる壁）で止める。穴は弾が通過するので射線も通す。
      if (isWallCell(this.stage, Math.floor(px / cell), Math.floor(py / cell))) break;
      if (this.enemies.some((e) => this.near(px, py, e.x, e.y))) break;
    }
    ctx.save();
    ctx.lineCap = "round";
    // 暗い縁取り（明るい床でも視認できるように）
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(this.pos.x, this.pos.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // 明るい本体（破線）
    ctx.strokeStyle = COLORS.aim;
    ctx.lineWidth = 3.5;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(this.pos.x, this.pos.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // 着弾点マーカー
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.aim;
    ctx.beginPath();
    ctx.arc(ex, ey, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
