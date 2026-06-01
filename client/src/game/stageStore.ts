// ToyTank Maker が localStorage に保存したステージを読み込む。
// 保存キーはエディタと共通の "toytank.stage.<name>"。同一オリジンなので共有される。

import type { StageData } from "../stage/types";
import { validateStage } from "../stage/validate";

const LS_PREFIX = "toytank.stage.";
const LS_CAMPAIGN = "toytank.campaign";

// 保存済みステージ名の一覧。
export function listSavedStages(): string[] {
  const names: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(LS_PREFIX)) names.push(key.slice(LS_PREFIX.length));
  }
  names.sort();
  return names;
}

// キャンペーン（再生順のステージ名リスト）を読み込む。
export function loadCampaign(): string[] {
  try {
    const raw = localStorage.getItem(LS_CAMPAIGN);
    if (!raw) return [];
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// キャンペーンを保存する。
export function saveCampaign(names: string[]): void {
  localStorage.setItem(LS_CAMPAIGN, JSON.stringify(names));
}

// 名前で読み込む。存在しない／壊れている／検証エラーなら null。
export function loadSavedStage(name: string): StageData | null {
  const raw = localStorage.getItem(LS_PREFIX + name);
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw) as StageData;
    const errs = validateStage(data);
    if (errs.length) {
      console.warn(`ステージ「${name}」は検証エラーのため読み込めません:`, errs);
      return null;
    }
    return data;
  } catch (e) {
    console.warn(`ステージ「${name}」の読み込みに失敗:`, e);
    return null;
  }
}
