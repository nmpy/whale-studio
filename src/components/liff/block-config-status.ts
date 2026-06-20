// src/components/liff/block-config-status.ts
// CMS 編集者向け: ブロックの「未設定（要設定）」判定 [PR-BLK2]。
//
// 純関数のみ（"use client" や JSX を含めない＝node テストで import 可能）。
// あくまで編集画面上の視覚補助で、保存や表示はブロックしない。
// 既存 settings key の値を「読むだけ」。型/スキーマ/レンダラー挙動には一切影響しない。
//
// 判定が曖昧なブロック（character_list / riddle_list / checkin_history / progress など、
// 必須入力が無くデータ駆動で表示されるもの）は意図的に「未設定」と判定しない（false）。

import type { LiffBlockType } from "@/types";

/** 文字列値が「実質的に入力済み」か（trim 後に非空）。 */
function filled(v: unknown): boolean {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * そのブロックが「最低限の必須項目すら未入力」かを返す。
 * true = 編集者に「未設定」と知らせてよい状態。
 * 不明・データ駆動のブロックは false（＝注意表示しない）。
 */
export function isBlockUnconfigured(
  blockType: string,
  settings: Record<string, unknown> | null | undefined,
): boolean {
  const s = settings ?? {};
  switch (blockType as LiffBlockType) {
    case "heading":
      return !filled(s.text);
    case "free_text":
    case "text":
      return !filled(s.body);
    case "image":
      return !filled(s.image_url);
    case "video":
      return !filled(s.video_url);
    case "button_link":
      // ラベル、または遷移先（外部URL / LIFFページ / ロケーション）のいずれかが無い。
      return !filled(s.label) || !(filled(s.url) || filled(s.liff_page_id) || filled(s.location_id));
    case "accordion":
      return !filled(s.title);
    case "warning":
      return !filled(s.body);
    case "code_reader":
      return !filled(s.label);
    // 以下は必須入力が無い / データ駆動のため「未設定」とは判定しない:
    //   divider（既定スタイルあり）/ progress / character_list / riddle_list /
    //   checkin_history / hint_list / evidence_list / start_button / resume_button
    default:
      return false;
  }
}
