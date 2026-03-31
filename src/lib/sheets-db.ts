// src/lib/sheets-db.ts
// Google Sheets をデータベースとして使用するためのキャッシュ付きデータローダー
//
// キャッシュ戦略: spreadsheetId ごとに全シートをメモリキャッシュ（デフォルト 5 分）
// 環境変数 SHEETS_CACHE_TTL_SECONDS で TTL を変更可能

import { fetchSheetRows, SheetRow } from "./google-sheets-client";

// ─────────────────────────────────────────────
// 型定義（スプレッドシートの実際のカラム名に対応）
// ─────────────────────────────────────────────

export interface SheetsWorkRow {
  work_id:             string;
  title:               string;
  description:         string | null;
  /** "public" | "active" | その他 */
  publish_status:      string;
  sort_order:          number;
  system_character_id: string | null;
  welcome_message:     string | null;
  /** カンマ区切りの開始キーワード（例: "はじめる,スタート"）*/
  start_keywords:      string | null;
  hidden:              boolean;
}

export interface SheetsCharacterRow {
  character_id:  string;
  work_id:       string;
  /** 内部識別子 */
  name:          string;
  /** LINE に表示される名前 */
  display_name:  string;
  icon_url:      string | null;
  order:         number;
  hidden:        boolean;
}

export interface SheetsPhaseRow {
  phase_id:    string;
  work_id:     string;
  name:        string;
  phase_type:  string;
  description: string | null;
  sort_order:  number;
  is_active:   boolean;
  hidden:      boolean;
}

export interface SheetsMessageRow {
  message_id:   string;
  work_id:      string;
  phase_id:     string;
  character_id: string | null;
  message_type: string;
  body:         string | null;
  asset_url:    string | null;
  sort_order:   number;
  is_active:    boolean;
  hidden:       boolean;
}

export interface SheetsTransitionRow {
  transition_id: string;
  work_id:       string;
  from_phase_id: string;
  to_phase_id:   string;
  label:         string;
  condition:     string | null;
  flag_condition: string | null;
  set_flags:     string;
  sort_order:    number;
  is_active:     boolean;
  hidden:        boolean;
}

export interface SheetsWelcomeMessageRow {
  welcome_id:         string;
  work_id:            string;
  character_id:       string | null;
  body:               string;
  /** カンマ区切りのクイックリプライラベル */
  quick_reply_labels: string | null;
  is_active:          boolean;
  hidden:             boolean;
}

export interface SheetsData {
  works:           SheetsWorkRow[];
  characters:      SheetsCharacterRow[];
  phases:          SheetsPhaseRow[];
  messages:        SheetsMessageRow[];
  transitions:     SheetsTransitionRow[];
  welcomeMessages: SheetsWelcomeMessageRow[];
  loadedAt:        Date;
}

// ─────────────────────────────────────────────
// キャッシュ
// ─────────────────────────────────────────────

interface CacheEntry {
  data:      SheetsData;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCacheTtlMs(): number {
  const sec = parseInt(process.env.SHEETS_CACHE_TTL_SECONDS ?? "300", 10);
  return (isNaN(sec) ? 300 : sec) * 1000;
}

// ─────────────────────────────────────────────
// 行パーサー（SheetRow → 型付きオブジェクト）
// ─────────────────────────────────────────────

function bool(v: unknown): boolean {
  return v === true || v === "TRUE" || v === "true" || v === "1";
}
function str(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}
function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function parseWork(r: SheetRow): SheetsWorkRow | null {
  const id = str(r["work_id"]);
  if (!id) return null;
  return {
    work_id:             id,
    title:               str(r["title"]) ?? "",
    description:         str(r["description"]),
    publish_status:      str(r["publish_status"]) ?? "",
    sort_order:          num(r["sort_order"]),
    system_character_id: str(r["system_character_id"]),
    welcome_message:     str(r["welcome_message"]),
    start_keywords:      str(r["start_keywords"]),
    hidden:              bool(r["hidden"]),
  };
}

function parseCharacter(r: SheetRow): SheetsCharacterRow | null {
  const id = str(r["character_id"]);
  if (!id) return null;
  return {
    character_id: id,
    work_id:      str(r["work_id"]) ?? "",
    name:         str(r["name"]) ?? id,
    display_name: str(r["display_name"]) ?? str(r["name"]) ?? id,
    icon_url:     str(r["icon_url"]) ?? str(r["icon_image_url"]),
    order:        num(r["order"]),
    hidden:       bool(r["hidden"]),
  };
}

function parsePhase(r: SheetRow): SheetsPhaseRow | null {
  const id = str(r["phase_id"]);
  if (!id) return null;
  return {
    phase_id:    id,
    work_id:     str(r["work_id"]) ?? "",
    name:        str(r["name"]) ?? "",
    phase_type:  str(r["phase_type"]) ?? "normal",
    description: str(r["description"]),
    sort_order:  num(r["sort_order"]),
    is_active:   r["is_active"] == null || bool(r["is_active"]),
    hidden:      bool(r["hidden"]),
  };
}

function parseMessage(r: SheetRow): SheetsMessageRow | null {
  const id = str(r["message_id"]);
  if (!id) return null;
  return {
    message_id:   id,
    work_id:      str(r["work_id"]) ?? "",
    phase_id:     str(r["phase_id"]) ?? "",
    character_id: str(r["character_id"]),
    message_type: str(r["message_type"]) ?? "text",
    body:         str(r["body"]),
    asset_url:    str(r["asset_url"]) ?? str(r["image_url"]),
    sort_order:   num(r["sort_order"]),
    is_active:    r["is_active"] == null || bool(r["is_active"]),
    hidden:       bool(r["hidden"]),
  };
}

function parseTransition(r: SheetRow): SheetsTransitionRow | null {
  const id = str(r["transition_id"]);
  if (!id) return null;
  return {
    transition_id:  id,
    work_id:        str(r["work_id"]) ?? "",
    from_phase_id:  str(r["from_phase_id"]) ?? "",
    to_phase_id:    str(r["to_phase_id"]) ?? "",
    label:          str(r["label"]) ?? "",
    condition:      str(r["condition"]),
    flag_condition: str(r["flag_condition"]),
    set_flags:      str(r["set_flags"]) ?? "{}",
    sort_order:     num(r["sort_order"]),
    is_active:      r["is_active"] == null || bool(r["is_active"]),
    hidden:         bool(r["hidden"]),
  };
}

function parseWelcomeMessage(r: SheetRow): SheetsWelcomeMessageRow | null {
  const id = str(r["welcome_id"]);
  if (!id) return null;
  return {
    welcome_id:         id,
    work_id:            str(r["work_id"]) ?? "",
    character_id:       str(r["character_id"]),
    body:               str(r["body"]) ?? "",
    quick_reply_labels: str(r["quick_reply_labels"]),
    is_active:          r["is_active"] == null || bool(r["is_active"]),
    hidden:             bool(r["hidden"]),
  };
}

// ─────────────────────────────────────────────
// メインのロード関数
// ─────────────────────────────────────────────

/**
 * スプレッドシートの全シートを読み込んでキャッシュする。
 * forceRefresh=true でキャッシュを無視して再取得する。
 */
export async function loadSheetsData(
  spreadsheetId: string,
  forceRefresh = false
): Promise<SheetsData> {
  const now = Date.now();

  if (!forceRefresh) {
    const cached = cache.get(spreadsheetId);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }
  }

  // 全シートを並列フェッチ
  const [worksRaw, charsRaw, phasesRaw, msgsRaw, transRaw, welcomeRaw] =
    await Promise.all([
      fetchSheetRows(spreadsheetId, "Works"),
      fetchSheetRows(spreadsheetId, "Characters"),
      fetchSheetRows(spreadsheetId, "Phases"),
      fetchSheetRows(spreadsheetId, "Messages"),
      fetchSheetRows(spreadsheetId, "Transitions"),
      fetchSheetRows(spreadsheetId, "WelcomeMessages").catch(() => [] as SheetRow[]),
    ]);

  const data: SheetsData = {
    works:           worksRaw.map(parseWork).filter((r): r is SheetsWorkRow => r !== null),
    characters:      charsRaw.map(parseCharacter).filter((r): r is SheetsCharacterRow => r !== null),
    phases:          phasesRaw.map(parsePhase).filter((r): r is SheetsPhaseRow => r !== null),
    messages:        msgsRaw.map(parseMessage).filter((r): r is SheetsMessageRow => r !== null),
    transitions:     transRaw.map(parseTransition).filter((r): r is SheetsTransitionRow => r !== null),
    welcomeMessages: welcomeRaw.map(parseWelcomeMessage).filter((r): r is SheetsWelcomeMessageRow => r !== null),
    loadedAt:        new Date(),
  };

  cache.set(spreadsheetId, {
    data,
    expiresAt: now + getCacheTtlMs(),
  });

  console.info(
    `[SheetsDB] loaded ${spreadsheetId.slice(0, 8)}… — ` +
    `works=${data.works.length} phases=${data.phases.length} msgs=${data.messages.length}`
  );

  return data;
}

/**
 * キャッシュを破棄する。次のアクセス時に再フェッチされる。
 */
export function invalidateSheetsCache(spreadsheetId: string): void {
  cache.delete(spreadsheetId);
  console.info(`[SheetsDB] cache invalidated: ${spreadsheetId.slice(0, 8)}…`);
}

/**
 * キャッシュ状態を返す（管理 UI 用）。
 */
export function getSheetsCacheStatus(spreadsheetId: string): {
  cached:    boolean;
  loadedAt:  string | null;
  expiresAt: string | null;
  ttlMs:     number;
} {
  const entry = cache.get(spreadsheetId);
  return {
    cached:    !!entry && entry.expiresAt > Date.now(),
    loadedAt:  entry ? entry.data.loadedAt.toISOString() : null,
    expiresAt: entry ? new Date(entry.expiresAt).toISOString() : null,
    ttlMs:     getCacheTtlMs(),
  };
}

// ─────────────────────────────────────────────
// クエリヘルパー
// ─────────────────────────────────────────────

/**
 * アクティブな作品を取得（publish_status == "public" or "active"、hidden=FALSE）。
 * sort_order の昇順で最初の 1 件。
 */
export function findActiveWork(data: SheetsData): SheetsWorkRow | null {
  return (
    data.works
      .filter(
        (w) =>
          !w.hidden &&
          (w.publish_status === "public" || w.publish_status === "active")
      )
      .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null
  );
}

export function findStartPhase(data: SheetsData, workId: string): SheetsPhaseRow | null {
  return (
    data.phases
      .filter((p) => p.work_id === workId && p.phase_type === "start" && p.is_active && !p.hidden)
      .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null
  );
}

export function findPhaseById(data: SheetsData, phaseId: string): SheetsPhaseRow | null {
  return data.phases.find((p) => p.phase_id === phaseId && !p.hidden) ?? null;
}

export function findActiveMessages(data: SheetsData, phaseId: string): SheetsMessageRow[] {
  return data.messages
    .filter((m) => m.phase_id === phaseId && m.is_active && !m.hidden)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function findActiveTransitions(data: SheetsData, fromPhaseId: string): SheetsTransitionRow[] {
  return data.transitions
    .filter((t) => t.from_phase_id === fromPhaseId && t.is_active && !t.hidden)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function findCharacterById(data: SheetsData, characterId: string): SheetsCharacterRow | null {
  return data.characters.find((c) => c.character_id === characterId && !c.hidden) ?? null;
}

export function findActiveWelcomeMessages(data: SheetsData, workId: string): SheetsWelcomeMessageRow[] {
  return data.welcomeMessages
    .filter((w) => w.work_id === workId && w.is_active && !w.hidden)
    .sort((a, b) => a.welcome_id.localeCompare(b.welcome_id));
}

/**
 * 作品の start_keywords（カンマ区切り）と照合する。
 * 一致した場合は true。スプレッドシート側でキーワードを定義できる。
 */
export function matchesStartKeyword(work: SheetsWorkRow, text: string): boolean {
  if (!work.start_keywords) return false;
  const keywords = work.start_keywords.split(",").map((k) => k.trim()).filter(Boolean);
  const norm = text.trim().toLowerCase();
  return keywords.some((kw) => kw.toLowerCase() === norm);
}
