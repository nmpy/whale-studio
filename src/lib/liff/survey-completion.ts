// src/lib/liff/survey-completion.ts
//
// アンケート「回答後の挙動」の純粋ロジック（DOM / LIFF SDK 非依存・テスト対象）。
//  - 完了後ボタン設定の解決（既定補完・妥当性チェック）
//  - 回答済みメッセージ / 複数回答可否の解決
//  - LIFF ホーム href の導出
// 実際の遷移・closeWindow などの副作用は SurveyCompletionButton（client）が担う。

import type { LiffPageConfigSettings, SurveyCompletionAction } from "@/types";

/** 回答済みメッセージのシステム既定文言。 */
export const SURVEY_ALREADY_ANSWERED_DEFAULT = "このアンケートは回答済みです。";

/** action ごとのボタン既定文言（CMS 未設定時）。 */
const ACTION_DEFAULT_LABEL: Record<SurveyCompletionAction, string> = {
  liff_home: "ホームに戻る",
  open_url:  "次へ進む",
  close:     "とじる",
};

export interface ResolvedCompletionButton {
  show:   boolean;
  label:  string;
  action: SurveyCompletionAction;
  /** action="open_url" のときの安全な遷移先（http/https）。それ以外 / 無効なら null。 */
  url:    string | null;
}

/** http / https のみ許可（javascript: 等を弾く）。 */
export function isSafeExternalUrl(url: string | null | undefined): boolean {
  const u = (url ?? "").trim();
  if (!u) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** 複数回答を許可するか。未設定 / false は「不許可」（既存アンケート互換の安全側）。 */
export function isMultipleAllowed(settings: LiffPageConfigSettings | null | undefined): boolean {
  return settings?.survey_allow_multiple === true;
}

/** 回答済みメッセージ（未設定 / 空白のみ はシステム既定）。 */
export function resolveAlreadyAnsweredMessage(settings: LiffPageConfigSettings | null | undefined): string {
  const m = settings?.survey_already_answered_message?.trim();
  return m && m.length > 0 ? m : SURVEY_ALREADY_ANSWERED_DEFAULT;
}

/**
 * 完了後ボタン設定を解決する。
 *  - 無効(enabled=false/未設定) は show=false。
 *  - action="open_url" は安全な url が無ければ show=false（誤導線・不正 URL を出さない）。
 *  - label 未設定は action ごとの既定文言。
 */
export function resolveCompletionButton(
  settings: LiffPageConfigSettings | null | undefined,
): ResolvedCompletionButton {
  const s = settings ?? {};
  const action = (s.survey_completion_button_action ?? "liff_home") as SurveyCompletionAction;
  const url = isSafeExternalUrl(s.survey_completion_button_url) ? s.survey_completion_button_url!.trim() : null;
  const label = (s.survey_completion_button_label ?? "").trim() || ACTION_DEFAULT_LABEL[action] || "OK";
  const enabled = s.survey_completion_button_enabled === true;
  const show = enabled && (action !== "open_url" || url !== null);
  return { show, label, action, url };
}

/**
 * LIFF ページ URL（`.../w/{workPublicId}/p/{pagePublicId}`）から作品メニューホーム
 * （`.../w/{workPublicId}`）を導出する。末尾の `/p/{pagePublicId}` を除去する。
 * 該当しない URL 形なら null（呼び出し側は遷移しない）。
 */
export function deriveLiffHomeHref(pathname: string | null | undefined): string | null {
  const p = (pathname ?? "").trim();
  if (!p) return null;
  const m = /^(.*\/w\/[^/]+)\/p\/[^/]+\/?$/.exec(p);
  return m ? m[1] : null;
}
