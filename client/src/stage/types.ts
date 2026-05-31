// ステージのデータ表現（BasicDesign §3）。
// ゲーム本体と ToyTank Maker（エディタ）が共有する唯一のステージ形式。

// タイル種別。壁はマス目単位で持つ。
export const TILE = {
  FLOOR: 0, // 床（通行可・射線を通す）
  STEEL: 1, // 壊せない壁（弾は反射）
  BRICK: 2, // 壊せる壁（弾で破壊され床になる）
} as const;

export type TileValue = 0 | 1 | 2;

// 敵の行動パターン（BasicDesign §10）。
export type EnemyPattern = "stationary" | "mover";

export interface Grid {
  cols: number; // 横のマス数
  rows: number; // 縦のマス数
  cell: number; // 1マスのピクセル数
}

// セル座標（マップ上のマス目位置）。
export interface CellPos {
  col: number;
  row: number;
}

// 敵の配置。
export interface EnemySpec {
  col: number;
  row: number;
  pattern: EnemyPattern;
}

// ステージ全体。
export interface StageData {
  name: string;
  grid: Grid;
  tiles: TileValue[][]; // [row][col]。rows 行 × cols 列。
  players: CellPos[]; // [0]=P1（必須）, [1]=P2（デュオ用・任意）
  enemies: EnemySpec[];
}
