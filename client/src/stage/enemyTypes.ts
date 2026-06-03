// 敵タイプのレジストリ（データ駆動）。色・移動・射撃などのAI設定をタイプごとに持つ。
// ステージデータの enemy.pattern はこのキーを参照する。
// 段階1ではタイプ1/2/4/6を実装。地雷・透明・HPなどの新メカニクスは順次対応（未対応分は無効）。

export type EnemyBehavior = "guard" | "approach" | "kite" | "balanced" | "chaser";

export interface EnemyType {
  key: string;
  name: string;
  color: string;
  speed: number; // 移動速度(px/s)。0=静止
  behavior: EnemyBehavior; // 行動性格
  fireInterval: number; // 発射間隔(秒)
  bullets: number; // 1回の発射数（>1で扇状の同時発射）
  bounces: number; // 弾の反射回数
  bulletSpeed: number; // 弾速(px/s)
  bank: boolean; // バンクショット可否
  aimJitter: number; // 照準ばらつき(rad)。小さいほど正確
  maxMines: number; // 設置できる地雷数（0=なし。※実装は後段）
  hp: number; // 撃破に必要な命中数
  invisible: boolean; // 透明化（※実装は後段）
}

const NORMAL_BULLET = 380;
const FAST_BULLET = 680; // ミサイル型の高速弾

export const ENEMY_TYPES: Record<string, EnemyType> = {
  // --- 旧2タイプ（互換のため維持） ---
  stationary: { key: "stationary", name: "砲台(赤)", color: "#c0392b", speed: 0, behavior: "guard", fireInterval: 2.6, bullets: 1, bounces: 1, bulletSpeed: NORMAL_BULLET, bank: true, aimJitter: 0, maxMines: 0, hp: 1, invisible: false },
  mover: { key: "mover", name: "遊撃(橙)", color: "#e08020", speed: 90, behavior: "balanced", fireInterval: 1.8, bullets: 1, bounces: 1, bulletSpeed: NORMAL_BULLET, bank: false, aimJitter: 0.12, maxMines: 0, hp: 1, invisible: false },

  // --- 新タイプ（段階1で実装） ---
  // 1. 木の色：静止・遅い・不正確・射線が通った時だけ撃つ（バンクなし）
  wood: { key: "wood", name: "木", color: "#9c6b3f", speed: 0, behavior: "guard", fireInterval: 3.2, bullets: 1, bounces: 1, bulletSpeed: NORMAL_BULLET, bank: false, aimJitter: 0.2, maxMines: 0, hp: 1, invisible: false },
  // 2. 灰：低速・回避重視・攻撃遅い（バンクなし）
  gray: { key: "gray", name: "灰", color: "#8a9099", speed: 70, behavior: "kite", fireInterval: 2.8, bullets: 1, bounces: 1, bulletSpeed: NORMAL_BULLET, bank: false, aimJitter: 0.1, maxMines: 0, hp: 1, invisible: false },
  // 4. 深緑：普通速・高精度直線・超高速ミサイル(反射0)（バンクなし）
  darkgreen: { key: "darkgreen", name: "深緑", color: "#1f7a47", speed: 95, behavior: "approach", fireInterval: 1.8, bullets: 1, bounces: 0, bulletSpeed: FAST_BULLET, bank: false, aimJitter: 0.02, maxMines: 0, hp: 1, invisible: false },
  // 6. 黄緑：静止・バンクあり・超高速で2回反射するミサイル
  yellowgreen: { key: "yellowgreen", name: "黄緑", color: "#9bc53d", speed: 0, behavior: "guard", fireInterval: 2.8, bullets: 1, bounces: 2, bulletSpeed: FAST_BULLET, bank: true, aimJitter: 0.05, maxMines: 0, hp: 1, invisible: false },
  // 3. 黄：攻撃的にプレイヤーを追い回す・地雷を最大4設置（バンクなし）
  yellow: { key: "yellow", name: "黄(地雷)", color: "#e0c020", speed: 100, behavior: "chaser", fireInterval: 1.8, bullets: 1, bounces: 1, bulletSpeed: NORMAL_BULLET, bank: false, aimJitter: 0.1, maxMines: 4, hp: 1, invisible: false },
  // 5. ピンク：高速・攻撃的・3連射（バンクなし）
  pink: { key: "pink", name: "ピンク", color: "#e84fa0", speed: 140, behavior: "approach", fireInterval: 1.0, bullets: 3, bounces: 1, bulletSpeed: NORMAL_BULLET, bank: false, aimJitter: 0.08, maxMines: 0, hp: 1, invisible: false },
};

export const ENEMY_TYPE_KEYS = Object.keys(ENEMY_TYPES);

export function getEnemyType(key: string): EnemyType {
  return ENEMY_TYPES[key] ?? ENEMY_TYPES.mover;
}
