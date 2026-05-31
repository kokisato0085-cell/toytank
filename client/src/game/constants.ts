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
