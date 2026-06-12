// ゲームの調整値（BasicDesign §13）。
export const TANK_RADIUS = 24; // 戦車の当たり半径(px)
export const TANK_SPEED = 140; // 戦車の最大速度(px/s)
export const TANK_TURN_RATE = 3.2; // 自機の旋回速度(rad/s)。約90°を0.5秒で向く
export const TANK_TURN_ALIGN = 0.35; // 停止から動き出すのに必要な向きの一致(rad)
export const STEP = 1 / 60; // 固定タイムステップ(秒)

export const BULLET_SPEED = 380; // 弾速(px/s)
export const BULLET_RADIUS = 9; // 弾のサイズ基準(px)。描画・当たり判定に共通
export const MAX_BOUNCES = 1; // 弾の反射上限
export const MAX_ACTIVE_BULLETS = 5; // 戦車ごとの画面内同時弾数
export const SELF_GRACE = 0.15; // 発射後に自機へ当たらない猶予(秒)
export const EXPLOSION_LIFE = 0.25; // 弾相殺の爆発エフェクトの寿命(秒)

export const MAX_MINES = 2; // 同時設置数
export const MINE_RADIUS = 18; // 地雷の見た目・被弾判定の半径(px)
export const MINE_ARM = 0.5; // 起動猶予(秒)。以後は中心が赤く点灯
export const MINE_FUSE = 6; // 信管(秒)。これで自動起爆
export const MINE_WARN = 2; // 起爆何秒前から警告点滅するか
export const MINE_BLAST_CELLS = 2.0; // 爆発半径 = この係数 × cell
export const MINE_BLAST_LIFE = 0.4; // 地雷の爆発エフェクトの寿命(秒)

// ※ 発射間隔・照準ばらつき・移動速度は敵タイプごとの値（stage/enemyTypes.ts）が正。
//    以前ここにあった ENEMY_COOLDOWN_MOVER/STATIONARY・ENEMY_AIM_JITTER・MOVER_SPEED は
//    データ駆動化で未参照になったため削除した。
export const ENEMY_NEAR = 280; // この距離内に自機がいると攻撃が激しくなる(px)
export const ENEMY_CLOSE = 150; // これより近いと壁越しでも接近を続ける（それ以外は守備的に）(px)
export const ENEMY_STANDOFF = 230; // 自機にこの距離まで近づいたら、追跡タイプでもそれ以上は詰めない(px)
export const ENEMY_STANDOFF_BREAK = 4; // 自機がこの秒数動かない（角待ち）と、敵はスタンドオフを解いて詰めてよい(秒)
export const ENEMY_OPENING_DELAY = 1.0; // ステージ開始/復活直後、敵が撃ち始めるまでの猶予の基準(秒)。実際は +0〜0.8
export const NEAR_FIRE_MULT = 0.55; // 近接時の発射間隔倍率（短く＝速く撃つ）
export const BEHAVIOR_MIN = 1.2; // 行動軸（戦闘/退避/無目的）の切替間隔の最小(秒)
export const BEHAVIOR_MAX = 2.8; // 同・最大(秒)
export const ENEMY_MINE_INTERVAL = 2.5; // 地雷を設置する敵の設置間隔(秒)
export const BURST_GAP = 0.26; // 逐次連射の1発ごとの間隔(秒)
export const CLOAK_TIME = 1.0; // 透明タイプが見えている時間(秒)。これを過ぎると消える
export const FIRE_STUN = 0.1; // 発射直後に移動できない時間(秒・全戦車共通)

export const SOLO_LIVES = 3; // ソロの残機
export const MAX_LIVES = 5; // 残機の上限（5ステージごとの回復で増やせる上限）

export const TRACK_GAP = 9; // キャタピラ跡を刻む移動間隔(px)
export const MAX_TRACKS = 1400; // 跡の最大数（超えたら古いものから消す）
export const RESPAWN_PAUSE = 2.2; // 被弾後、再開までの区切りポーズ(秒)
export const INTRO_PAUSE = 2.2; // ステージ開始の区切り画面の表示時間(秒)
export const STAGE_CLEAR_PAUSE = 2.4; // ステージクリアのポップアップ表示時間(秒)
export const DEATH_FX = 0.85; // 自機が大破する演出の時間(秒)
