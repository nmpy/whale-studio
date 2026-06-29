// src/lib/admin-help/types.ts
// 管理画面ヘルプAI（MVP）の型定義。

/** ヘルプ知識のカテゴリ（MVP の静的 knowledge）。 */
export type AdminHelpCategory =
  | "general"
  | "messages"
  | "quick_reply"
  | "phase"
  | "puzzle_hint"
  | "image_action"
  | "carousel"
  | "liff_pages"
  | "survey"
  | "faq"
  | "checkin"
  | "announcement"
  | "audit_log"
  | "monthly_message_count"
  | "scheduled_messages";

/** 1 件の固定ヘルプ知識。OpenAI に渡す「回答の元ネタ」。 */
export type AdminHelpKnowledgeItem = {
  id:           AdminHelpCategory;
  title:        string;
  keywords:     string[];
  /** この知識を優先するパス断片（例: "/messages"）。 */
  pathPatterns?: string[];
  content:      string;
};

/** クライアント → /api/admin/help-ai リクエスト。内部ID・本文・個人情報は含めない。 */
export type AdminHelpRequest = {
  question:     string;
  pathname?:    string;
  pageTitle?:   string;
  contextType?: string;
};

/** /api/admin/help-ai → クライアント レスポンス。 */
export type AdminHelpResponse = {
  answer:              string;
  suggestedQuestions?: string[];
};

/** 質問文の最大長（サーバ・クライアント共通）。 */
export const ADMIN_HELP_QUESTION_MAX = 1000;
