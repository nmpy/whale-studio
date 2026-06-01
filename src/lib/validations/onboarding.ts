// src/lib/validations/onboarding.ts
// オンボーディング系 API の Zod スキーマ。

import { z } from "zod";

// ── 利用規約同意 ──────────────────────────────────────────────────
export const acceptTermsSchema = z.object({
  terms_version: z.string().min(1, "termsVersion は必須です"),
});

// ── プライバシーポリシー同意 ─────────────────────────────────────
export const acceptPrivacyPolicySchema = z.object({
  privacy_policy_version: z.string().min(1, "privacyPolicyVersion は必須です"),
});

// ── Step 2: OA 連携情報 ──────────────────────────────────────────
export const updateOnboardingOaSchema = z.object({
  oa_name:        z.string().max(100).optional().nullable(),
  channel_id:     z.string().max(100).optional().nullable(),
  channel_secret: z.string().max(200).optional().nullable(),
  channel_token:  z.string().max(500).optional().nullable(),
  basic_id:       z.string().max(50).optional().nullable(),
  liff_id:        z.string().max(100).optional().nullable(),
});

// ── Step 3: 権限URL提出 ──────────────────────────────────────────
export const submitOnboardingOaSchema = z.object({
  permission_url: z
    .string()
    .min(1, "権限URLは必須です")
    .url("有効なURLを入力してください")
    .startsWith("https://", "https:// から始まるURLを入力してください"),
});

// ── Admin: 審査ステータス変更 ─────────────────────────────────────
export const adminUpdateOnboardingSchema = z.object({
  status: z.enum(["IN_REVIEW", "APPROVED", "REJECTED"]),
  review_note: z.string().max(1000).optional().nullable(),
});
