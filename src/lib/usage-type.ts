// src/lib/usage-type.ts
//
// OA の「利用区分 (個人 / 法人)」を扱う純ヘルパー。
// client / server 双方から import するため node 依存を持たない
// (= business-invite.ts は node:crypto を含むため client から import 不可。こちらは pure)。
//
// DB は Phase2 で追加済みの enum `BusinessUsageType { personal, business }` を再利用する
// (= 新しい enum は増やさない方針)。Oa.usageType の default は personal。

import { z } from "zod";

export type UsageType = "personal" | "business";

export const USAGE_TYPES: readonly UsageType[] = ["personal", "business"];

/** 短い表示ラベル (= 一覧 / バッジ用)。値: 個人 / 法人。 */
export const USAGE_TYPE_SHORT_LABELS: Record<UsageType, string> = {
  personal: "個人",
  business: "法人",
};

/** 値 → 短い表示名。未設定 / 不明値は既定の「個人」にフォールバックする
 *  (= 既存データの default が personal のため、基本は「個人」表示で問題ない方針)。 */
export function usageTypeShortLabel(value: string | null | undefined): string {
  return value === "business" ? "法人" : "個人";
}

/** API 入力等で利用区分を検証する zod スキーマ。 */
export const usageTypeSchema = z.enum(["personal", "business"]);
