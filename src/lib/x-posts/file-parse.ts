// src/lib/x-posts/file-parse.ts
// CSV / Excel ファイルをクライアントで解析し、import API に渡す JSON rows
// （Record<string, unknown>[]・1行目=ヘッダー、2行目以降=データ）へ変換する。
// CSV: papaparse / Excel(.xlsx): exceljs（1枚目のシート）。
// X API / スクレイピングは使わない（ユーザーがインポートしたファイルのみが対象）。

import Papa from "papaparse";

export type ImportType = "metrics" | "mentions" | "x_export";
export type ParsedRows = Record<string, unknown>[];

export interface ParseResult {
  rows: ParsedRows;
  error: string | null;
  warnings: string[];
}

const FORMAT_HINT = "対応しているファイル形式は CSV / Excel（.xlsx）です。";

/** Excel セル値を CSV と同等の素朴な値（string / number）へ正規化する。 */
function cellToValue(v: unknown): unknown {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString(); // 日付セルは ISO 文字列へ
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("text" in o && "hyperlink" in o) return (o.text ?? o.hyperlink ?? "") as unknown; // ハイパーリンクセル
    if ("richText" in o && Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    if ("result" in o) return cellToValue(o.result); // 数式セルは計算結果を使う
    if ("formula" in o) return "";
    return String(v);
  }
  return v; // number / string / boolean はそのまま
}

/** CSV をパース（UTF-8 / BOM 両対応・空行スキップ）。 */
function parseCsv(file: File): Promise<ParsedRows> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data.filter((r) => r && typeof r === "object")),
      error: () => reject(new Error("CSV の解析に失敗しました。")),
    });
  });
}

/** Excel(.xlsx) の 1 枚目シートをパース（1行目=ヘッダー・空行スキップ）。 */
async function parseXlsx(file: File): Promise<ParsedRows> {
  // exceljs はブラウザ向けバンドルが大きいため動的 import（必要時のみロード）。
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount === 0) throw new Error("Excel のシートが空です。");

  // 1行目をヘッダーとして列番号→キー名のマップを作る。
  const headers: Record<number, string> = {};
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const key = String(cellToValue(cell.value) ?? "").trim();
    if (key) headers[col] = key;
  });
  if (Object.keys(headers).length === 0) throw new Error("1行目にヘッダー行が必要です。");

  const rows: ParsedRows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // ヘッダー行
    const obj: Record<string, unknown> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = headers[col];
      if (!key) return;
      const val = cellToValue(cell.value);
      obj[key] = val;
      if (val !== "" && val != null) hasValue = true;
    });
    if (hasValue) rows.push(obj); // 空行はスキップ
  });
  return rows;
}

/** 必須列チェック（CSV / Excel 共通）。error はブロッキング、warnings は非ブロッキング。 */
export function validateRows(type: ImportType, rows: ParsedRows): { error: string | null; warnings: string[] } {
  const warnings: string[] = [];
  if (rows.length === 0) return { error: "データ行が見つかりませんでした。1行目にヘッダー行、2行目以降にデータを入れてください。", warnings };
  const keys = Object.keys(rows[0]).map((k) => k.trim());
  if (keys.length === 0 || keys.every((k) => !k)) return { error: "1行目にヘッダー行が必要です。", warnings };
  const has = (...names: string[]) => names.some((n) => keys.includes(n));

  if (type === "metrics") {
    if (!has("xPostUrl", "x_post_url", "xPostId", "x_post_id", "xPostExternalId"))
      return { error: "投稿実績ファイルには xPostUrl または xPostId の列が必要です。", warnings };
    if (!has("impressions", "Impressions")) return { error: "投稿実績ファイルには impressions が必要です。", warnings };
  } else if (type === "mentions") {
    if (!has("text", "tweetText")) return { error: "口コミファイルには text または tweetText が必要です。", warnings };
  } else {
    // x_export（X投稿エクスポート形式）。本文は tweetText / text のどちらでも可。
    if (!has("tweetText", "text")) return { error: "X投稿エクスポートには tweetText または text が必要です。", warnings };
    if (!has("views")) warnings.push("views がないため、インプレッションは空として取り込みます。");
    if (!has("tweetURL") && !has("id")) warnings.push("tweetURL または id がない行は重複判定が弱くなります。");
  }
  return { error: null, warnings };
}

/** 拡張子で CSV / Excel を判定して解析し、検証まで行う。 */
export async function parseImportFile(file: File, type: ImportType): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  const isCsv = name.endsWith(".csv");
  const isXlsx = name.endsWith(".xlsx");
  if (!isCsv && !isXlsx) return { rows: [], error: FORMAT_HINT, warnings: [] };

  let rows: ParsedRows;
  try {
    rows = isCsv ? await parseCsv(file) : await parseXlsx(file);
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : "ファイルの解析に失敗しました。", warnings: [] };
  }

  const { error, warnings } = validateRows(type, rows);
  if (error) return { rows: [], error, warnings };
  return { rows, error: null, warnings };
}
