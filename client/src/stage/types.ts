// ステージのデータ表現（BasicDesign §3）。
// ゲーム本体と ToyTank Maker（エディタ）が共有する唯一のステージ形式。

// タイル種別。壁はマス目単位で持つ。
export const TILE = {
  FLOOR: 0, // 床（戦車・弾とも通行可）
  STEEL: 1, // 壊せない壁（戦車不可・弾は反射）
  BRICK: 2, // 壊せる壁（戦車不可・弾は反射、地雷の爆発で破壊）
  HOLE: 3, // 穴（戦車は通れない／弾・射線・爆風は通る・落下なし）
} as const;

export type TileValue = 0 | 1 | 2 | 3;

// 敵タイプのキー（enemyTypes.ts のレジストリを参照）。
export type EnemyPattern = string;

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
