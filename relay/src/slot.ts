// ゲストのスロットid割当（純ロジック・§12-l）。
// host=id0 固定。ゲストには 1..max の空いている最小idを割り当て、満室なら -1。
// index.ts（Durable Object）から使い、単体テストしやすいよう副作用なしで切り出す。

// 使用中スロットの集合に対し、空いている最小スロット（1..max）を返す。満室なら -1。
export function nextFreeSlot(used: Iterable<number>, max: number): number {
  const set = new Set(used);
  for (let s = 1; s <= max; s++) if (!set.has(s)) return s;
  return -1;
}
