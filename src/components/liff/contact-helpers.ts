// src/components/liff/contact-helpers.ts
//
// お問い合わせフォーム（page_type="contact"）の純ロジック（JSX なし・client/server/テスト共有）。
//  - resolveContactConfig: settingsJson から表示/必須フラグを既定値込みで解決
//  - validateContactSubmission: クライアント/サーバ共通のバリデーション
//  - buildContactSubmissionBlocks: 送信内容を LiffSubmission.answersJson.blocks 形式へ
// 未設定でも 500 にせず安全に扱う。

import type { LiffPageConfigSettings, SurveyItem } from "@/types";
import { buildSubmissionAnswers, type SubmissionAnswerBlock } from "@/lib/liff/submission";

/** お問い合わせ内容（本文）の最大文字数（固定）。 */
export const CONTACT_BODY_MAX = 100;

/** 送信完了の標準文言（settings 未設定時）。 */
export const DEFAULT_CONTACT_SUCCESS_MESSAGE =
  "送信しました。お問い合わせありがとうございました。";

/** 固定項目のラベル（保存ブロック / 表示で共通利用）。 */
export const CONTACT_LABELS = {
  category: "問い合わせ種別",
  name:     "お名前",
  email:    "メールアドレス",
  body:     "お問い合わせ内容",
} as const;

export interface ContactConfig {
  categories:       string[];
  categoryRequired: boolean;
  showName:         boolean;
  nameRequired:     boolean;
  showEmail:        boolean;
  emailRequired:    boolean;
  bodyRequired:     boolean;
  customFields:     SurveyItem[];
  successMessage:   string;
}

/** settingsJson から ContactConfig を既定値込みで解決する（未設定セーフ）。
 *  表示フラグ（show_*）は未設定=表示(true)、必須フラグは未設定=任意(false)、本文必須は既定 true。 */
export function resolveContactConfig(
  settings: LiffPageConfigSettings | null | undefined,
): ContactConfig {
  const s = settings ?? {};
  const categories = (Array.isArray(s.contact_categories) ? s.contact_categories : [])
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter((c) => c !== "");
  const customFields = Array.isArray(s.contact_custom_fields) ? s.contact_custom_fields : [];
  const success = (s.contact_success_message ?? "").trim();
  return {
    categories,
    categoryRequired: s.contact_category_required !== false, // 既定: 必須
    showName:         s.contact_show_name !== false,         // 既定: 表示
    nameRequired:     s.contact_name_required === true,      // 既定: 任意
    showEmail:        s.contact_show_email !== false,        // 既定: 表示
    emailRequired:    s.contact_email_required === true,     // 既定: 任意
    bodyRequired:     s.contact_body_required !== false,     // 既定: 必須
    customFields,
    successMessage:   success || DEFAULT_CONTACT_SUCCESS_MESSAGE,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** メール形式の簡易検証（空文字は false ではなく呼び出し側で判断）。 */
export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export interface ContactPayload {
  category?: string | null;
  name?:     string | null;
  email?:    string | null;
  body?:     string | null;
  /** custom_fields の回答マップ（itemKey -> string | string[]）。 */
  custom_answers?: Record<string, string | string[]> | null;
}

const isEmptyStr = (v: unknown): boolean => typeof v !== "string" || v.trim() === "";
function customItemKey(item: SurveyItem, idx: number): string {
  return item.id || `q${idx}`;
}

/**
 * 送信内容を検証する（クライアント / サーバ共通）。
 * エラーがあれば日本語メッセージ、無ければ null。
 */
export function validateContactSubmission(
  cfg: ContactConfig,
  payload: ContactPayload,
): string | null {
  // 種別
  if (cfg.categories.length > 0) {
    const cat = (payload.category ?? "").trim();
    if (cfg.categoryRequired && cat === "") return `「${CONTACT_LABELS.category}」を選択してください`;
    if (cat !== "" && !cfg.categories.includes(cat)) return `「${CONTACT_LABELS.category}」の値が不正です`;
  }
  // お名前
  if (cfg.showName && cfg.nameRequired && isEmptyStr(payload.name)) {
    return `「${CONTACT_LABELS.name}」を入力してください`;
  }
  // メール
  if (cfg.showEmail) {
    const email = (payload.email ?? "").trim();
    if (cfg.emailRequired && email === "") return `「${CONTACT_LABELS.email}」を入力してください`;
    if (email !== "" && !isValidEmail(email)) return `「${CONTACT_LABELS.email}」の形式が正しくありません`;
  }
  // 本文
  const body = (payload.body ?? "");
  if (cfg.bodyRequired && body.trim() === "") return `「${CONTACT_LABELS.body}」を入力してください`;
  if (body.length > CONTACT_BODY_MAX) return `「${CONTACT_LABELS.body}」は${CONTACT_BODY_MAX}文字以内で入力してください`;
  // custom fields の必須
  const answers = payload.custom_answers ?? {};
  for (let i = 0; i < cfg.customFields.length; i++) {
    const it = cfg.customFields[i];
    if (!it.required) continue;
    const v = answers[customItemKey(it, i)];
    if (it.input_type === "checkbox") {
      if (!Array.isArray(v) || v.length === 0) return `「${it.question || `項目${i + 1}`}」は必須です`;
    } else if (isEmptyStr(v)) {
      return `「${it.question || `項目${i + 1}`}」は必須です`;
    }
  }
  return null;
}

/**
 * 送信内容を LiffSubmission.answersJson.blocks 形式に整形する。
 * 固定項目（種別/名前/メール/本文）+ custom fields。空・非表示はスキップ。
 * すべて blockType="contact"。
 */
export function buildContactSubmissionBlocks(
  cfg: ContactConfig,
  payload: ContactPayload,
): SubmissionAnswerBlock[] {
  const blocks: SubmissionAnswerBlock[] = [];

  const cat = (payload.category ?? "").trim();
  if (cfg.categories.length > 0 && cat !== "") {
    blocks.push({ blockId: "contact_category", blockType: "contact", label: CONTACT_LABELS.category, answerType: "singleChoice", value: cat });
  }
  const name = (payload.name ?? "").trim();
  if (cfg.showName && name !== "") {
    blocks.push({ blockId: "contact_name", blockType: "contact", label: CONTACT_LABELS.name, answerType: "text", value: name });
  }
  const email = (payload.email ?? "").trim();
  if (cfg.showEmail && email !== "") {
    blocks.push({ blockId: "contact_email", blockType: "contact", label: CONTACT_LABELS.email, answerType: "text", value: email });
  }
  const body = (payload.body ?? "").trim();
  if (body !== "") {
    blocks.push({ blockId: "contact_body", blockType: "contact", label: CONTACT_LABELS.body, answerType: "text", value: body });
  }

  // custom fields は survey と同じ itemKey 規則。blockType だけ "contact" に揃える。
  const customBlocks = buildSubmissionAnswers(cfg.customFields, payload.custom_answers ?? {});
  for (const b of customBlocks) blocks.push({ ...b, blockType: "contact" });

  return blocks;
}
