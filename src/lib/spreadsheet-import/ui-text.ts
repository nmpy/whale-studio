// src/lib/spreadsheet-import/ui-text.ts
// スプレッドシート取り込み UI/route 共有: feature flag 判定と、非エンジニア向けエラー文言の生成。
// pure（client/server 双方で利用）。exceljs/prisma に依存しない。

import type { ImportError, SheetName } from "./types";

/** feature flag。NEXT_PUBLIC_* は build 時 inline かつ server runtime の env 双方で読める。 */
export function isSpreadsheetImportEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_SPREADSHEET_IMPORT === "true";
}

const SHEET_JP: Record<SheetName | "file", string> = {
  characters: "キャラクター",
  phases: "フェーズ",
  messages: "メッセージ",
  file: "ファイル",
};

/** 「{シート} シート {row}行目：」（file / row=0 は行番号を出さない）。 */
function prefix(e: ImportError): string {
  const s = SHEET_JP[e.sheet] ?? String(e.sheet);
  if (e.sheet === "file" || !e.row || e.row <= 0) return `${s}：`;
  return `${s} シート ${e.row}行目：`;
}

/** 参照エラーは「どこを直すか」を追記して分かりやすくする。 */
function refBody(e: ImportError): string {
  const col = e.column ?? "";
  if (col === "character_key") return `${e.message}。characters シートに該当のキャラクターがあるか確認してください。`;
  // phase_key / next_phase_key / choice_n_next_phase_key はいずれもフェーズ参照
  return `${e.message}。phases シートに該当のフェーズがあるか確認してください。`;
}

/**
 * ImportError → 非エンジニア向け1行メッセージ。
 * 既知 code は分かりやすい本文に整形、未知 code は API の message をそのまま使う。
 * 必ず「どのシート / 何行目 / 何を直すか」が伝わる形にする。
 */
export function formatImportError(e: ImportError): string {
  const p = prefix(e);
  switch (e.code) {
    case "REF_NOT_FOUND":
      return p + refBody(e);
    case "SHEET_MISSING":
    case "COLUMN_MISSING":
    case "REQUIRED":
    case "DUPLICATE_KEY":
    case "NOT_NUMBER":
    case "BAD_BOOL":
    case "BAD_KIND":
    case "DUP_SORT_ORDER":
    case "CHOICE_PAIR":
    case "CHOICE_NONE":
    case "START_PHASE_MULTIPLE":
    case "START_PHASE_CONFLICT":
    case "DUP_RESPONSE_KEYWORD":
    case "DELAY_RANGE":
      // PR2 の message は日本語で具体的なため、prefix を付けてそのまま使う。
      return p + e.message;
    default:
      return p + e.message; // 未知 code も message をそのまま表示
  }
}
