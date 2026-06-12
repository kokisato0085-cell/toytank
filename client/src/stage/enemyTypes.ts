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
  bullets: number; // 発射数（連射なら逐次の発数、salvoなら同時発射数）
  salvo?: boolean; // true=同じ瞬間に扇状で同時発射（砲台複数門）。省略/false=同じ発射口から逐次連射
  bounces: number; // 弾の反射回数
  bulletSpeed: number; // 弾速(px/s)
  bank: boolean; // バンクショット可否
  scale?: number; // 機体サイズ倍率（省略=1）。当たり判定・描画に反映
  aimJitter: number; // 照準ばらつき(rad)。小さいほど正確
  maxMines: number; // 設置できる地雷数（0=なし。※実装は後段）
  hp: number; // 撃破に必要な命中数
  invisible: boolean; // 透明化（※実装は後段）
  dodge?: boolean; // true=プレイヤーの弾（反射軌道含む）を予測して回避する高知能AI
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
  // 7. 紫：高速攻撃的・超高速5連射・反射1・バンクあり・地雷なし
  purple: { key: "purple", name: "紫", color: "#8e44ad", speed: 130, behavior: "approach", fireInterval: 0.8, bullets: 5, bounces: 1, bulletSpeed: NORMAL_BULLET, bank: true, aimJitter: 0.1, maxMines: 0, hp: 1, invisible: false },
  // 9. 黒：超高速・追跡・最速2連射・反射0ミサイル・地雷なし（最強）
  black: { key: "black", name: "黒", color: "#222831", speed: 180, behavior: "chaser", fireInterval: 0.6, bullets: 2, bounces: 0, bulletSpeed: FAST_BULLET, bank: false, aimJitter: 0.05, maxMines: 0, hp: 1, invisible: false },
  // 8. 白：紫と同スペック＋開始1秒後に煙とともに透明化（轍と発射位置で推測）
  white: { key: "white", name: "白(透明)", color: "#eef0f2", speed: 130, behavior: "approach", fireInterval: 0.8, bullets: 5, bounces: 1, bulletSpeed: NORMAL_BULLET, bank: true, aimJitter: 0.1, maxMines: 2, hp: 1, invisible: true },
  // 10. 赤黒紫：普通速・バンクあり・砲台5門同時・普通弾・HP12
  boss: { key: "boss", name: "ボス", color: "#5b2c4d", speed: 90, behavior: "balanced", fireInterval: 1.6, bullets: 5, bounces: 1, bulletSpeed: NORMAL_BULLET, bank: true, scale: 2, aimJitter: 0.06, maxMines: 0, hp: 12, invisible: false, salvo: true },
  // 11. 銀：スペックは紫と同じ。高知能AIでプレイヤーの弾（直線＋反射軌道）を予測回避し、とにかく粘る
  silver: { key: "silver", name: "銀", color: "#c8ccd4", speed: 130, behavior: "approach", fireInterval: 2.0, bullets: 2, bounces: 1, bulletSpeed: NORMAL_BULLET, bank: true, aimJitter: 0.12, maxMines: 0, hp: 1, invisible: false, dodge: true },
};

export const ENEMY_TYPE_KEYS = Object.keys(ENEMY_TYPES);

export function getEnemyType(key: string): EnemyType {
  return ENEMY_TYPES[key] ?? ENEMY_TYPES.mover;
}
