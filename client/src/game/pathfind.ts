// グリッド上の経路探索（BFS）。戦車が通れるのは床セルのみ（壁・穴・場外は不可）。
// 始点セルから目標セルへの最短経路の「次の一歩のセル」を返す。到達不可・同一セルなら null。

import { isSolidCell } from "./physics";
import type { StageData } from "../stage/types";

export function nextStepToward(
  stage: StageData,
  sc: number,
  sr: number,
  tc: number,
  tr: number,
): { col: number; row: number } | null {
  const { cols, rows } = stage.grid;
  if (sc === tc && sr === tr) return null;
  if (tc < 0 || tc >= cols || tr < 0 || tr >= rows) return null;

  const n = cols * rows;
  const prev = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  const sIdx = sr * cols + sc;
  const tIdx = tr * cols + tc;
  visited[sIdx] = 1;
  queue[tail++] = sIdx;

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let found = false;
  while (head < tail) {
    const cur = queue[head++];
    if (cur === tIdx) {
      found = true;
      break;
    }
    const cc = cur % cols;
    const cr = (cur - cc) / cols;
    for (const [dx, dy] of dirs) {
      const nc = cc + dx;
      const nr = cr + dy;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      if (isSolidCell(stage, nc, nr)) continue; // 床以外は通れない
      const ni = nr * cols + nc;
      if (visited[ni]) continue;
      visited[ni] = 1;
      prev[ni] = cur;
      queue[tail++] = ni;
    }
  }
  if (!found) return null;

  // 目標から逆走し、始点の隣（最初の一歩）を求める
  let cur = tIdx;
  while (prev[cur] !== sIdx && prev[cur] !== -1) cur = prev[cur];
  if (prev[cur] === -1) return null;
  return { col: cur % cols, row: (cur - (cur % cols)) / cols };
}
