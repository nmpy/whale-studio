// src/lib/spreadsheet-import/file-guard.ts
// 取り込みアップロードファイルの事前チェック（拡張子 / MIME / サイズ）。route と test が共有する。

/** アップロード上限（10MB）。 */
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

/** 許容 MIME。空 / octet-stream はブラウザ差で来るため許容し、拡張子で担保する。 */
const ALLOWED_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "",
]);

export type FileCheck = { ok: true } | { ok: false; code: "INVALID_FILE" | "FILE_TOO_LARGE"; message: string };

/** .xlsx 以外・MIME 不一致・サイズ超過を弾く。OK なら { ok: true }。 */
export function checkImportFile(file: File): FileCheck {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, code: "INVALID_FILE", message: "対応しているのは .xlsx ファイルのみです" };
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    return { ok: false, code: "INVALID_FILE", message: "対応しているのは .xlsx ファイルのみです" };
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE", message: "ファイルサイズが上限(10MB)を超えています" };
  }
  return { ok: true };
}
