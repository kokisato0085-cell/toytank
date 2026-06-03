// ToyTank Maker（ステージエディタ）。
// マウス／タッチでマップと配置を編集し、BasicDesign §3 の JSON を書き出し／読み込みする。
// 純粋ロジックは stage/ 配下（edit.ts / validate.ts）に分離し、本ファイルは UI 配線に専念する。

import { TILE } from "../stage/types";
import type { CellPos, EnemyPattern, EnemySpec, StageData, TileValue } from "../stage/types";
import { ENEMY_TYPES, ENEMY_TYPE_KEYS } from "../stage/enemyTypes";
import { createEmptyStage, fillBorderSteel, resizeStage } from "../stage/edit";
import { validateStage } from "../stage/validate";
import { listSavedStages, loadCampaign, saveCampaign } from "../game/stageStore";

// 編集中の内部状態。P1/P2 を区別して持ち、書き出し時に StageData.players へ並べる。
interface EditorState {
  name: string;
  grid: { cols: number; rows: number; cell: number };
  tiles: TileValue[][];
  p1: CellPos | null;
  p2: CellPos | null;
  enemies: EnemySpec[];
}

type Tool =
  | "paint-floor"
  | "paint-steel"
  | "paint-brick"
  | "paint-hole"
  | "place-p1"
  | "place-p2"
  | "place-enemy"
  | "erase";

const VIEW = 32; // 表示上の1マスのピクセル数（編集用。ゲーム内の cell とは独立）。

const COLORS = {
  floor: "#e8e6df",
  steel: "#5a5f6a",
  brick: "#b5723a",
  hole: "#222a36",
  line: "#c8c8c8",
  p1: "#2d7dd2",
  p2: "#2a8a3e",
  stationary: "#c0392b",
  mover: "#e08020",
};

// ---- 状態 ----
let state: EditorState = initialState();
let tool: Tool = "paint-floor";
let painting = false;

function initialState(): EditorState {
  const base = fillBorderSteel(createEmptyStage(20, 15, 64));
  return { name: "stage-01", grid: base.grid, tiles: base.tiles, p1: null, p2: null, enemies: [] };
}

// 内部状態から書き出し用の StageData を組み立てる。
function buildStage(): StageData {
  const players: CellPos[] = [];
  if (state.p1) players.push(state.p1);
  if (state.p2) players.push(state.p2);
  return { name: state.name, grid: state.grid, tiles: state.tiles, players, enemies: state.enemies };
}

// ---- DOM 参照 ----
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`要素が見つかりません: ${id}`);
  return el as T;
};
const canvas = $<HTMLCanvasElement>("grid");
const ctx = canvas.getContext("2d")!;
const messages = $<HTMLDivElement>("messages");
const inName = $<HTMLInputElement>("in-name");
const inCols = $<HTMLInputElement>("in-cols");
const inRows = $<HTMLInputElement>("in-rows");
const inCell = $<HTMLInputElement>("in-cell");
const jsonText = $<HTMLTextAreaElement>("json-text");
const selSaved = $<HTMLSelectElement>("sel-saved");
const selCampaignAdd = $<HTMLSelectElement>("sel-campaign-add");
const campaignList = $<HTMLOListElement>("campaign-list");
const selEnemyType = $<HTMLSelectElement>("enemy-type");
for (const k of ENEMY_TYPE_KEYS) {
  const o = document.createElement("option");
  o.value = k;
  o.textContent = ENEMY_TYPES[k].name;
  selEnemyType.appendChild(o);
}

const LS_PREFIX = "toytank.stage.";

// ---- 編集操作 ----
function removeSpawnAt(col: number, row: number): void {
  if (state.p1 && state.p1.col === col && state.p1.row === row) state.p1 = null;
  if (state.p2 && state.p2.col === col && state.p2.row === row) state.p2 = null;
  state.enemies = state.enemies.filter((e) => !(e.col === col && e.row === row));
}

function setTile(col: number, row: number, v: TileValue): void {
  state.tiles[row][col] = v;
}

function placeEnemy(col: number, row: number, pattern: EnemyPattern): void {
  setTile(col, row, TILE.FLOOR);
  removeSpawnAt(col, row);
  state.enemies.push({ col, row, pattern });
}

function applyAt(col: number, row: number): void {
  switch (tool) {
    case "paint-floor":
      setTile(col, row, TILE.FLOOR);
      break;
    case "paint-steel":
      setTile(col, row, TILE.STEEL);
      removeSpawnAt(col, row);
      break;
    case "paint-brick":
      setTile(col, row, TILE.BRICK);
      removeSpawnAt(col, row);
      break;
    case "paint-hole":
      setTile(col, row, TILE.HOLE);
      removeSpawnAt(col, row);
      break;
    case "place-p1":
      setTile(col, row, TILE.FLOOR);
      removeSpawnAt(col, row);
      state.p1 = { col, row };
      break;
    case "place-p2":
      setTile(col, row, TILE.FLOOR);
      removeSpawnAt(col, row);
      state.p2 = { col, row };
      break;
    case "place-enemy":
      placeEnemy(col, row, selEnemyType.value);
      break;
    case "erase":
      setTile(col, row, TILE.FLOOR);
      removeSpawnAt(col, row);
      break;
  }
}

const isPaintTool = (): boolean => tool.startsWith("paint-") || tool === "erase";

// ---- 描画 ----
function render(): void {
  const { cols, rows } = state.grid;
  canvas.width = cols * VIEW;
  canvas.height = rows * VIEW;

  // タイル
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = state.tiles[r][c];
      if (v === TILE.HOLE) {
        ctx.fillStyle = COLORS.floor;
        ctx.fillRect(c * VIEW, r * VIEW, VIEW, VIEW);
        ctx.fillStyle = COLORS.hole;
        ctx.beginPath();
        ctx.arc((c + 0.5) * VIEW, (r + 0.5) * VIEW, VIEW / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = v === TILE.STEEL ? COLORS.steel : v === TILE.BRICK ? COLORS.brick : COLORS.floor;
        ctx.fillRect(c * VIEW, r * VIEW, VIEW, VIEW);
      }
    }
  }
  // グリッド線
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * VIEW + 0.5, 0);
    ctx.lineTo(c * VIEW + 0.5, rows * VIEW);
    ctx.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * VIEW + 0.5);
    ctx.lineTo(cols * VIEW, r * VIEW + 0.5);
    ctx.stroke();
  }
  // 配置物
  if (state.p1) drawDisc(state.p1, COLORS.p1, "1");
  if (state.p2) drawDisc(state.p2, COLORS.p2, "2");
  for (const e of state.enemies) {
    drawSquare(e, ENEMY_TYPES[e.pattern]?.color ?? "#c0392b");
  }
}

function cx(col: number): number {
  return col * VIEW + VIEW / 2;
}
function cy(row: number): number {
  return row * VIEW + VIEW / 2;
}

function drawDisc(p: CellPos, color: string, label: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx(p.col), cy(p.row), VIEW * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.floor(VIEW * 0.5)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx(p.col), cy(p.row));
}

function drawSquare(p: CellPos, color: string): void {
  ctx.fillStyle = color;
  const s = VIEW * 0.62;
  ctx.fillRect(cx(p.col) - s / 2, cy(p.row) - s / 2, s, s);
}

// ---- 検証メッセージ ----
function updateMessages(): void {
  const errs = validateStage(buildStage());
  if (!state.p1) errs.unshift("P1 を配置してください");
  if (errs.length === 0) {
    messages.className = "ok";
    messages.textContent = "✓ 妥当なステージです（書き出し可能）";
  } else {
    messages.className = "ng";
    messages.textContent = "⚠ " + errs.join("\n⚠ ");
  }
}

function refresh(): void {
  render();
  updateMessages();
  jsonText.value = currentJson();
}

function currentJson(): string {
  return JSON.stringify(buildStage(), null, 2);
}

// 任意のオブジェクト（読み込んだJSON等）から編集状態を復元する。失敗時は例外。
function loadFromObject(raw: unknown): void {
  state = toEditorState(raw);
  syncInputs();
  refresh();
}

// 読み込み系の共通エラー表示。
function showLoadError(err: unknown): void {
  messages.className = "ng";
  messages.textContent = "⚠ 読み込み失敗：" + (err instanceof Error ? err.message : String(err));
}

// ---- ポインタ操作 ----
function cellFromEvent(e: PointerEvent): CellPos | null {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const col = Math.floor(x / VIEW);
  const row = Math.floor(y / VIEW);
  if (col < 0 || col >= state.grid.cols || row < 0 || row >= state.grid.rows) return null;
  return { col, row };
}

canvas.addEventListener("pointerdown", (e) => {
  const cell = cellFromEvent(e);
  if (!cell) return;
  canvas.setPointerCapture(e.pointerId);
  painting = isPaintTool();
  applyAt(cell.col, cell.row);
  refresh();
});
canvas.addEventListener("pointermove", (e) => {
  if (!painting) return;
  const cell = cellFromEvent(e);
  if (!cell) return;
  applyAt(cell.col, cell.row);
  refresh();
});
canvas.addEventListener("pointerup", () => {
  painting = false;
});

// ---- 道具パレット ----
for (const btn of document.querySelectorAll<HTMLButtonElement>("#palette .tool")) {
  btn.addEventListener("click", () => {
    tool = btn.dataset.tool as Tool;
    for (const b of document.querySelectorAll("#palette .tool")) b.classList.remove("active");
    btn.classList.add("active");
  });
}

// ---- グリッド設定 ----
$("btn-resize").addEventListener("click", () => {
  const cols = clampInt(inCols.value, 3, 60, state.grid.cols);
  const rows = clampInt(inRows.value, 3, 60, state.grid.rows);
  const cell = clampInt(inCell.value, 16, 128, state.grid.cell);
  const resized = resizeStage(buildStage(), cols, rows);
  state.grid = { cols, rows, cell };
  state.tiles = resized.tiles;
  state.enemies = resized.enemies;
  state.p1 = resized.players[0] ?? null;
  state.p2 = resized.players[1] ?? null;
  syncInputs();
  refresh();
});

$("btn-border").addEventListener("click", () => {
  state.tiles = fillBorderSteel(buildStage()).tiles;
  // 外周に重なった配置は除去
  for (const sp of [state.p1, state.p2]) {
    if (sp && isBorder(sp.col, sp.row)) removeSpawnAt(sp.col, sp.row);
  }
  state.enemies = state.enemies.filter((e) => !isBorder(e.col, e.row));
  refresh();
});

$("btn-new").addEventListener("click", () => {
  if (!confirm("現在の編集内容を消して新規作成しますか？")) return;
  state = initialState();
  syncInputs();
  refresh();
});

function isBorder(col: number, row: number): boolean {
  return col === 0 || row === 0 || col === state.grid.cols - 1 || row === state.grid.rows - 1;
}

// ---- 書き出し・読み込み ----
$("btn-export").addEventListener("click", () => {
  state.name = inName.value.trim() || "stage";
  const json = JSON.stringify(buildStage(), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.name}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$<HTMLInputElement>("file-import").addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadFromObject(JSON.parse(String(reader.result)));
    } catch (err) {
      showLoadError(err);
    }
  };
  reader.readAsText(file);
});

// テキスト欄の JSON を反映（コピペ往復用）。
$("btn-apply-text").addEventListener("click", () => {
  try {
    loadFromObject(JSON.parse(jsonText.value));
  } catch (err) {
    showLoadError(err);
  }
});

// ---- ブラウザ内保存（localStorage） ----
function refreshSavedList(): void {
  const names: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(LS_PREFIX)) names.push(key.slice(LS_PREFIX.length));
  }
  names.sort();
  selSaved.innerHTML = '<option value="">（保存したステージ）</option>';
  for (const n of names) {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = n;
    selSaved.appendChild(opt);
  }
}

$("btn-save-local").addEventListener("click", () => {
  const name = inName.value.trim() || "stage";
  state.name = name;
  localStorage.setItem(LS_PREFIX + name, currentJson());
  refreshSavedList();
  renderCampaign();
  selSaved.value = name;
  // 未完成（検証エラー）のまま保存した場合は警告（ゲームでは弾かれてサンプル表示になる）
  const errs = validateStage(buildStage());
  if (!state.p1) errs.unshift("P1 を配置してください");
  if (errs.length) {
    messages.className = "ng";
    messages.textContent = `⚠ 「${name}」を保存しましたが未完成です（このままではゲームで遊べません）：\n⚠ ${errs.join("\n⚠ ")}`;
  } else {
    messages.className = "ok";
    messages.textContent = `✓ 「${name}」を保存しました（ゲームで遊べます）`;
  }
});

$("btn-load-local").addEventListener("click", () => {
  const name = selSaved.value;
  if (!name) return;
  const raw = localStorage.getItem(LS_PREFIX + name);
  if (raw === null) return;
  try {
    loadFromObject(JSON.parse(raw));
  } catch (err) {
    showLoadError(err);
  }
});

$("btn-delete-local").addEventListener("click", () => {
  const name = selSaved.value;
  if (!name) return;
  if (!confirm(`保存した「${name}」を削除しますか？`)) return;
  localStorage.removeItem(LS_PREFIX + name);
  refreshSavedList();
});

// ---- ステージ順（キャンペーン） ----
function mkBtn(label: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.marginLeft = "4px";
  b.addEventListener("click", fn);
  return b;
}

function renderCampaign(): void {
  // 追加用ドロップダウン（保存済みステージ）
  selCampaignAdd.innerHTML = "";
  for (const n of listSavedStages()) {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
    selCampaignAdd.appendChild(o);
  }
  // 順番リスト
  const camp = loadCampaign();
  campaignList.innerHTML = "";
  camp.forEach((name, i) => {
    const li = document.createElement("li");
    li.textContent = name + " ";
    li.append(
      mkBtn("↑", () => {
        if (i > 0) {
          [camp[i - 1], camp[i]] = [camp[i], camp[i - 1]];
          saveCampaign(camp);
          renderCampaign();
        }
      }),
      mkBtn("↓", () => {
        if (i < camp.length - 1) {
          [camp[i + 1], camp[i]] = [camp[i], camp[i + 1]];
          saveCampaign(camp);
          renderCampaign();
        }
      }),
      mkBtn("✕", () => {
        camp.splice(i, 1);
        saveCampaign(camp);
        renderCampaign();
      }),
    );
    campaignList.appendChild(li);
  });
}

$("btn-campaign-add").addEventListener("click", () => {
  const name = selCampaignAdd.value;
  if (!name) return;
  const camp = loadCampaign();
  camp.push(name);
  saveCampaign(camp);
  renderCampaign();
});

// 読み込んだ JSON を編集状態へ（最小限の防御的チェック）。
function toEditorState(raw: unknown): EditorState {
  if (typeof raw !== "object" || raw === null) throw new Error("JSON の形式が不正です");
  const o = raw as Record<string, unknown>;
  const g = (o.grid ?? {}) as Record<string, unknown>;
  const cols = Number(g.cols);
  const rows = Number(g.rows);
  const cell = Number(g.cell);
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || !Number.isFinite(cell)) {
    throw new Error("grid(cols/rows/cell) が不正です");
  }
  if (!Array.isArray(o.tiles)) throw new Error("tiles が配列ではありません");
  const tiles = (o.tiles as unknown[]).map((line) =>
    Array.isArray(line) ? (line as unknown[]).map((v) => Number(v) as TileValue) : [],
  );
  const players = Array.isArray(o.players) ? (o.players as CellPos[]) : [];
  const enemies = Array.isArray(o.enemies) ? (o.enemies as EnemySpec[]) : [];
  return {
    name: typeof o.name === "string" ? o.name : "stage",
    grid: { cols, rows, cell },
    tiles,
    p1: players[0] ?? null,
    p2: players[1] ?? null,
    enemies,
  };
}

// ---- ユーティリティ ----
function clampInt(raw: string, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function syncInputs(): void {
  inName.value = state.name;
  inCols.value = String(state.grid.cols);
  inRows.value = String(state.grid.rows);
  inCell.value = String(state.grid.cell);
}

// ---- 起動 ----
syncInputs();
refreshSavedList();
renderCampaign();
refresh();
