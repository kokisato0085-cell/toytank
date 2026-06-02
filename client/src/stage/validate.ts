// ステージデータの検証（BasicDesign §3「制約」）。
// エラーメッセージの配列を返す（空配列＝妥当）。エディタの警告表示とゲーム読込時の弾きに使う。

import type { StageData } from "./types";
import { ENEMY_TYPE_KEYS } from "./enemyTypes";

function inBounds(col: number, row: number, cols: number, rows: number): boolean {
  return col >= 0 && col < cols && row >= 0 && row < rows;
}

// 範囲内であることが前提（呼び出し側で inBounds 済み）。
function tileAt(s: StageData, col: number, row: number): number {
  return s.tiles[row][col];
}

export function validateStage(s: StageData): string[] {
  const errors: string[] = [];
  const { cols, rows, cell } = s.grid;

  // グリッド寸法
  if (!Number.isInteger(cols) || cols <= 0) errors.push("grid.cols は正の整数である必要があります");
  if (!Number.isInteger(rows) || rows <= 0) errors.push("grid.rows は正の整数である必要があります");
  if (!Number.isInteger(cell) || cell <= 0) errors.push("grid.cell は正の整数である必要があります");

  // tiles が rows×cols の矩形か、値が 0/1/2 か
  if (s.tiles.length !== rows) {
    errors.push(`tiles の行数(${s.tiles.length})が grid.rows(${rows})と一致しません`);
  }
  for (let r = 0; r < s.tiles.length; r++) {
    const line = s.tiles[r];
    if (line.length !== cols) {
      errors.push(`tiles[${r}] の列数(${line.length})が grid.cols(${cols})と一致しません`);
    }
    for (let c = 0; c < line.length; c++) {
      const v = line[c];
      if (v !== 0 && v !== 1 && v !== 2 && v !== 3) {
        errors.push(`tiles[${r}][${c}] の値(${v})が不正です（0/1/2/3のみ）`);
      }
    }
  }

  // プレイヤー数
  if (s.players.length < 1) errors.push("プレイヤー開始位置 P1 が必要です");
  if (s.players.length > 2) errors.push("プレイヤー開始位置は最大2つ(P1,P2)です");

  // 敵数
  if (s.enemies.length < 1) errors.push("敵は1体以上配置してください");

  // 開始位置（範囲内・床・重複なし）。tiles が矩形でない場合は床判定をスキップして範囲のみ見る。
  const tilesOk = s.tiles.length === rows && s.tiles.every((line) => line.length === cols);
  const occupied = new Map<string, string>(); // "col,row" -> ラベル
  const checkSpawn = (col: number, row: number, label: string): void => {
    if (!inBounds(col, row, cols, rows)) {
      errors.push(`${label} の位置(${col},${row})がマップ外です`);
      return;
    }
    if (tilesOk && tileAt(s, col, row) !== 0) {
      errors.push(`${label} の開始セル(${col},${row})が床ではありません`);
    }
    const key = `${col},${row}`;
    const prev = occupied.get(key);
    if (prev) errors.push(`${label} の位置(${col},${row})が ${prev} と重複しています`);
    else occupied.set(key, label);
  };

  s.players.forEach((p, i) => checkSpawn(p.col, p.row, `P${i + 1}`));
  s.enemies.forEach((e, i) => {
    if (!ENEMY_TYPE_KEYS.includes(e.pattern)) {
      errors.push(`敵${i + 1} の pattern(${e.pattern})が不正です（未知の敵タイプ）`);
    }
    checkSpawn(e.col, e.row, `敵${i + 1}`);
  });

  return errors;
}
