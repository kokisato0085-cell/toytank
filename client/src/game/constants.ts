// ゲームの調整値（BasicDesign §13）。
export const TANK_RADIUS = 24; // 戦車の当たり半径(px)
export const TANK_SPEED = 140; // 戦車の最大速度(px/s)
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

export const ENEMY_COOLDOWN_MOVER = 1.8; // 移動型の発射間隔(秒)
export const ENEMY_COOLDOWN_STATIONARY = 2.6; // 静止型の発射間隔(秒)
export const ENEMY_AIM_JITTER = 0.12; // 移動型の照準のばらつき(rad・約7°)
export const MOVER_SPEED = 90; // 移動型の敵の速度(px/s)

export const SOLO_LIVES = 3; // ソロの残機
