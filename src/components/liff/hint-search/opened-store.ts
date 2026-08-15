// src/components/liff/hint-search/opened-store.ts
//
// 「ヒント一覧」= **これまでに開いたヒントだけ** の履歴。
//
// ネタバレ設計上の要点:
//   一覧は未開封のヒントを一切載せない。そのため一覧の材料はサーバーから取らず、
//   プレイヤー自身の端末に残った開封履歴だけで組み立てる（= まだ開いていないヒントの
//   タイトルはクライアントにも届かない）。
//
// 保存先は localStorage。ページ単位でキーを分ける。
// 保存できない環境（プライベートモード / 容量超過 / SSR）でも例外を投げず、
// 「履歴なし」として静かに劣化する。

const STORAGE_PREFIX = "whale.hintSearch.opened.";
/** 保持する最大件数（古いものから捨てる）。 */
const MAX_RECORDS = 100;

export interface OpenedHintRecord {
  id:    string;
  label: string;
  /** 開示済みの段階ヒント数。 */
  revealedHints: number;
  /** 登録されている段階ヒント数。 */
  totalHints:    number;
  hasAnswer:      boolean;
  answerRevealed: boolean;
  /** 最終更新時刻（新しい順に並べるため）。 */
  updatedAt: number;
}

function storageKey(pageId: string): string {
  return `${STORAGE_PREFIX}${pageId}`;
}

function readRaw(pageId: string): OpenedHintRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(pageId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord);
  } catch {
    return [];
  }
}

function isRecord(v: unknown): v is OpenedHintRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<OpenedHintRecord>;
  return typeof r.id === "string" && typeof r.label === "string"
    && typeof r.revealedHints === "number" && typeof r.totalHints === "number";
}

/** 開封履歴を新しい順で返す。 */
export function loadOpenedHints(pageId: string): OpenedHintRecord[] {
  return readRaw(pageId)
    .slice()
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** 1 件の開封状態を保存（既存があれば更新）し、更新後の一覧を返す。 */
export function saveOpenedHint(pageId: string, record: Omit<OpenedHintRecord, "updatedAt">): OpenedHintRecord[] {
  const next: OpenedHintRecord = { ...record, updatedAt: Date.now() };
  const merged = [next, ...readRaw(pageId).filter((r) => r.id !== record.id)].slice(0, MAX_RECORDS);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(storageKey(pageId), JSON.stringify(merged));
    } catch {
      // 保存できなくても表示は続ける（履歴が残らないだけ）。
    }
  }
  return merged;
}

/** 指定ヒントの開示済み段階数を取り出す。未開封なら 0。 */
export function openedRevealCount(records: OpenedHintRecord[], id: string): number {
  return records.find((r) => r.id === id)?.revealedHints ?? 0;
}

/** 指定ヒントの答えを既に開いているか。 */
export function openedAnswerRevealed(records: OpenedHintRecord[], id: string): boolean {
  return records.find((r) => r.id === id)?.answerRevealed === true;
}

/** 一覧行のステータス文言を組み立てる。例: "ヒント1・2を表示済 ／ 残り1件" / "すべて表示済" */
export function openedStatusText(r: OpenedHintRecord): string {
  const total    = r.totalHints + (r.hasAnswer ? 1 : 0);
  const revealed = r.revealedHints + (r.answerRevealed ? 1 : 0);
  if (revealed >= total) return "すべて表示済";
  if (r.revealedHints <= 0) return `残り${total}件`;
  const shown = Array.from({ length: r.revealedHints }, (_, i) => i + 1).join("・");
  return `ヒント${shown}を表示済 ／ 残り${total - revealed}件`;
}
