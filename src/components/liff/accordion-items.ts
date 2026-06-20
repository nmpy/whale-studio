// src/components/liff/accordion-items.ts
// PR-BLK4d: アコーディオンの「複数項目（multi）」解決（純関数・no JSX → node テスト可）。
//
// settings.items を安全に正規化して「実際に描画する item 配列」を返す。
//   - 非配列 / undefined        → []（= 既存 single 表示にフォールバック）
//   - 各 item は { title, body } に正規化（文字列以外は ""）
//   - title・body とも空（trim 後）の item は除外
//   - 1件以上残れば multi 表示、0件なら single 表示（呼び出し側で length 判定）
// 副作用なし。window/document/prisma/fetch 等に依存しない。

export interface AccordionItem {
  title: string;
  body: string;
}

/** items を安全に正規化（不正値はスキップ・空 item は除外）。multi 判定は戻り値 length>0 で行う。 */
export function resolveAccordionItems(items: unknown): AccordionItem[] {
  if (!Array.isArray(items)) return [];
  const result: AccordionItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title : "";
    const body  = typeof r.body  === "string" ? r.body  : "";
    if (title.trim() === "" && body.trim() === "") continue;
    result.push({ title, body });
  }
  return result;
}
