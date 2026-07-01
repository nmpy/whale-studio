// src/lib/spreadsheet-import/types.ts
// スプレッドシート取り込み(キャラ/フェーズ/メッセージ)MVP の共通型。
// parse → normalize → validate → preview → apply の各段で共有する。

export type SheetName = "characters" | "phases" | "messages";

/** message_kind の正規化後 enum。 */
export type MessageKind = "line" | "narration" | "system" | "image" | "choice" | "input_wait";

/** 日本語/英語 → enum 正規化マップ。 */
export const MESSAGE_KIND_ALIASES: Record<string, MessageKind> = {
  line: "line", "セリフ": "line",
  narration: "narration", "ナレーション": "narration",
  system: "system", "システム": "system",
  image: "image", "画像": "image",
  choice: "choice", "選択肢": "choice",
  input_wait: "input_wait", "入力待ち": "input_wait",
};

/** シート名の日本語エイリアス → 正規シート名。 */
export const SHEET_ALIASES: Record<string, SheetName> = {
  characters: "characters", "キャラクター": "characters",
  phases: "phases", "フェーズ": "phases",
  messages: "messages", "メッセージ": "messages",
};

/** parse 結果: 各シートの生データ（セルは文字列・1行目=ヘッダー）。null=シート不在。 */
export interface RawRow { _row: number; [col: string]: string | number }
export type RawSheets = { characters: RawRow[] | null; phases: RawRow[] | null; messages: RawRow[] | null };

// ── normalize 後の型 ──────────────────────────────────
export type NormCharacter = {
  row: number;
  characterKey: string;
  name: string;
  iconImageUrl: string | null;
  displayOrderRaw: string;
  displayOrder: number | null; // 数値化できない/空は null（validate で数値チェック）
};
export type NormPhase = {
  row: number;
  phaseKey: string;
  name: string;
  displayOrderRaw: string;
  displayOrder: number | null;
  isStartPhaseRaw: string;
  isStartPhase: boolean | null; // null=空 / 解釈不能は validate でエラー
  startTrigger: string | null;
  summary: string | null;
  isActiveRaw: string;
  isActive: boolean | null; // 空=未入力(=true扱い)
};
export type NormChoice = { n: number; label: string | null; nextPhaseKey: string | null };
export type NormMessage = {
  row: number;
  messageKey: string;
  phaseKey: string;
  sortOrderRaw: string;
  sortOrder: number | null;
  kindRaw: string;
  kind: MessageKind | null; // null=許可値外（validate でエラー）
  characterKey: string | null;
  content: string | null;
  imageUrl: string | null;
  choices: NormChoice[]; // 常に 4 件（1..4）
  responseKeyword: string | null;
  nextPhaseKey: string | null;
  delayRaw: string;
  delaySeconds: number | null; // 空=null / 数値化できない場合も null（validate で raw を見て判定）
};
export type NormalizedSheets = {
  characters: NormCharacter[];
  phases: NormPhase[];
  messages: NormMessage[];
};

/** 取り込み時に参照する既存DBスナップショット（route が prisma から構築）。 */
export type ExistingData = {
  characterKeys: Set<string>;
  phaseKeys: Set<string>;
  messageKeys: Set<string>;
  /** 既存の開始フェーズ（phaseType="start"・1件想定）。null=無し。 */
  existingStartPhase: { phaseKey: string | null } | null;
  /** 既存 Transition の `${fromPhaseKey}::${condition}` 集合（fromPhase に key がある分のみ）。preview 用。 */
  transitionKeys: Set<string>;
};

// ── validate / preview / apply の戻り ──────────────────
export type ImportErrorCode =
  | "SHEET_MISSING" | "COLUMN_MISSING" | "REQUIRED" | "DUPLICATE_KEY" | "NOT_NUMBER"
  | "BAD_BOOL" | "BAD_KIND" | "REF_NOT_FOUND" | "DUP_SORT_ORDER" | "CHOICE_PAIR"
  | "CHOICE_NONE" | "START_PHASE_MULTIPLE" | "START_PHASE_CONFLICT" | "DUP_RESPONSE_KEYWORD"
  | "DELAY_RANGE" | "PARSE_ERROR";
export type ImportError = { sheet: SheetName | "file"; row: number; column?: string; code: ImportErrorCode; message: string };

export type CountTriple = { create: number; update: number; unchanged?: number };
export type ImportSummary = {
  characters: CountTriple;
  phases: CountTriple;
  messages: CountTriple;
  transitions: CountTriple;
};
export type PreviewRow = {
  sheet: string; row: number; key: string;
  action: "create" | "update" | "unchanged" | "error";
  changedFields?: string[];
};
export type ImportPreview = {
  ok: boolean;
  errors: ImportError[];
  summary: ImportSummary;
  rows?: PreviewRow[];
};
export type ImportResult = { ok: true; applied: ImportSummary; appliedAt: string };

export const REQUIRED_COLUMNS: Record<SheetName, string[]> = {
  characters: ["character_key", "name"],
  phases:     ["phase_key", "name"],
  messages:   ["message_key", "phase_key", "sort_order", "message_kind"],
};
