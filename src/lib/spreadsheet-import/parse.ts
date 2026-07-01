// src/lib/spreadsheet-import/parse.ts
// .xlsx（1ファイル・3シート）を読み、各シートを RawRow[]（セル文字列・1行目=ヘッダー）へ変換する。
// シート名は英語(characters/phases/messages)正・日本語エイリアスも許容。シート不在は null。

import type { RawSheets, RawRow, SheetName } from "./types";
import { SHEET_ALIASES } from "./types";

/** Excel セル値を素朴な文字列へ正規化（数式は結果・ハイパーリンク/リッチテキスト対応）。 */
function cellToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("text" in o) return String(o.text ?? "");
    if ("richText" in o && Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    if ("result" in o) return cellToString(o.result);  // 数式セル: 保存済みの計算結果があればそれを使う
    if ("hyperlink" in o) return String(o.hyperlink ?? "");
    if ("formula" in o) return "";  // 計算結果キャッシュのない数式セルは空欄扱い（README で固定値/プルダウン推奨を明記）
    return String(v);
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

/** ArrayBuffer/Buffer から .xlsx を parse。例外時は PARSE_ERROR として呼び出し側で扱えるよう throw。 */
export async function parseWorkbook(buffer: ArrayBuffer | Buffer): Promise<RawSheets> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);

  const out: RawSheets = { characters: null, phases: null, messages: null };

  for (const ws of wb.worksheets) {
    const sheet = SHEET_ALIASES[String(ws.name).trim()] as SheetName | undefined;
    if (!sheet || out[sheet] !== null) continue; // 未知シート/重複は無視（最初の1枚を採用）

    // 1 行目をヘッダー（列番号→キー名）に。
    const headers: Record<number, string> = {};
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
      const key = cellToString(cell.value).trim();
      if (key) headers[col] = key;
    });

    const rows: RawRow[] = [];
    const lastRow = ws.rowCount;
    for (let r = 2; r <= lastRow; r++) {
      const row = ws.getRow(r);
      const obj: RawRow = { _row: r };
      let hasAny = false;
      for (const [colStr, key] of Object.entries(headers)) {
        const val = cellToString(row.getCell(Number(colStr)).value).trim();
        obj[key] = val;
        if (val) hasAny = true;
      }
      if (hasAny) rows.push(obj); // 全列空の行はスキップ
    }
    out[sheet] = rows;
  }

  return out;
}
