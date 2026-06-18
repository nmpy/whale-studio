// src/components/liff/faq-helpers.ts
//
// FAQ 表示用の純ロジック（JSX を含まない .ts）。テストから安全に import できる。

import type { FaqItem } from "@/types";

/**
 * 表示対象の FAQ 項目だけを返す。
 *  - question / answer が両方とも空（trim 後）の項目は除外する。
 *  - null / undefined / 非配列でも 500 にせず空配列を返す（未設定セーフ）。
 *  - 並び順は維持する。
 */
export function visibleFaqItems(items: FaqItem[] | null | undefined): FaqItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter(
    (it) => ((it?.question ?? "").trim() !== "") || ((it?.answer ?? "").trim() !== "")
  );
}
