// src/__tests__/survey-completion.test.ts
// アンケート「回答後の挙動」純関数の単体（既定補完・URL 妥当性・ホーム導出・複数回答/回答済み判定）。
import { describe, it, expect } from "vitest";
import {
  resolveCompletionButton,
  resolveAlreadyAnsweredMessage,
  isMultipleAllowed,
  isSafeExternalUrl,
  deriveLiffHomeHref,
  validateCompletionButtonSettings,
  SURVEY_ALREADY_ANSWERED_DEFAULT,
  SURVEY_COMPLETION_LABEL_MAX,
  SURVEY_COMPLETION_MESSAGE_MAX,
} from "@/lib/liff/survey-completion";
import type { LiffPageConfigSettings } from "@/types";

const S = (o: Partial<LiffPageConfigSettings>): LiffPageConfigSettings => o as LiffPageConfigSettings;

describe("isMultipleAllowed", () => {
  it("未設定/false は不許可（既存互換の安全側）、true のみ許可", () => {
    expect(isMultipleAllowed(undefined)).toBe(false);
    expect(isMultipleAllowed(S({}))).toBe(false);
    expect(isMultipleAllowed(S({ survey_allow_multiple: false }))).toBe(false);
    expect(isMultipleAllowed(S({ survey_allow_multiple: true }))).toBe(true);
  });
});

describe("resolveAlreadyAnsweredMessage", () => {
  it("未設定/空白はシステム既定、設定時はその文言", () => {
    expect(resolveAlreadyAnsweredMessage(undefined)).toBe(SURVEY_ALREADY_ANSWERED_DEFAULT);
    expect(resolveAlreadyAnsweredMessage(S({}))).toBe("このアンケートは回答済みです。");
    expect(resolveAlreadyAnsweredMessage(S({ survey_already_answered_message: "   " }))).toBe(SURVEY_ALREADY_ANSWERED_DEFAULT);
    expect(resolveAlreadyAnsweredMessage(S({ survey_already_answered_message: "既に回答いただいています。" }))).toBe("既に回答いただいています。");
  });
});

describe("isSafeExternalUrl", () => {
  it("http/https のみ true、その他は false", () => {
    expect(isSafeExternalUrl("https://example.com")).toBe(true);
    expect(isSafeExternalUrl("http://example.com/x?y=1")).toBe(true);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("ftp://x")).toBe(false);
    expect(isSafeExternalUrl("/relative")).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
    expect(isSafeExternalUrl(null)).toBe(false);
  });
});

describe("resolveCompletionButton", () => {
  it("enabled=false/未設定 は show=false", () => {
    expect(resolveCompletionButton(undefined).show).toBe(false);
    expect(resolveCompletionButton(S({})).show).toBe(false);
    expect(resolveCompletionButton(S({ survey_completion_button_enabled: false })).show).toBe(false);
  });

  it("liff_home（既定 action）: enabled で show=true、既定文言", () => {
    const r = resolveCompletionButton(S({ survey_completion_button_enabled: true }));
    expect(r).toMatchObject({ show: true, action: "liff_home", label: "ホームに戻る", url: null });
  });

  it("close: 既定文言 とじる", () => {
    const r = resolveCompletionButton(S({ survey_completion_button_enabled: true, survey_completion_button_action: "close" }));
    expect(r).toMatchObject({ show: true, action: "close", label: "とじる" });
  });

  it("open_url: 有効 URL があれば show=true・url 正規化", () => {
    const r = resolveCompletionButton(S({
      survey_completion_button_enabled: true,
      survey_completion_button_action: "open_url",
      survey_completion_button_url: "  https://example.com/next  ",
    }));
    expect(r).toMatchObject({ show: true, action: "open_url", url: "https://example.com/next" });
  });

  it("open_url: URL 未設定/不正 は show=false（誤導線を出さない）", () => {
    expect(resolveCompletionButton(S({ survey_completion_button_enabled: true, survey_completion_button_action: "open_url" })).show).toBe(false);
    expect(resolveCompletionButton(S({ survey_completion_button_enabled: true, survey_completion_button_action: "open_url", survey_completion_button_url: "javascript:x" })).show).toBe(false);
  });

  it("label 設定時はそれを使う（trim）", () => {
    const r = resolveCompletionButton(S({ survey_completion_button_enabled: true, survey_completion_button_label: "  次へ  " }));
    expect(r.label).toBe("次へ");
  });

  // ── send_line_message（label と message を分離して保持する） ──────
  it("send_line_message: message があれば show=true・label と message を別々に返す", () => {
    const r = resolveCompletionButton(S({
      survey_completion_button_enabled: true,
      survey_completion_button_action:  "send_line_message",
      survey_completion_button_label:   "参加する",
      survey_completion_button_message: "  参加を申し込みます  ",
    }));
    expect(r).toMatchObject({
      show:    true,
      action:  "send_line_message",
      label:   "参加する",
      message: "参加を申し込みます", // trim される
    });
    expect(r.message).not.toBe(r.label); // label は送信文言ではない
  });

  it("send_line_message: 既定文言は「LINE でメッセージを送信」（label 未設定時）", () => {
    const r = resolveCompletionButton(S({
      survey_completion_button_enabled: true,
      survey_completion_button_action:  "send_line_message",
      survey_completion_button_message: "送ります",
    }));
    expect(r.label).toBe("LINE でメッセージを送信");
  });

  it("send_line_message: message 未設定/空白のみ は show=false（空メッセージを送らない）", () => {
    const base = { survey_completion_button_enabled: true, survey_completion_button_action: "send_line_message" } as const;
    expect(resolveCompletionButton(S({ ...base })).show).toBe(false);
    expect(resolveCompletionButton(S({ ...base, survey_completion_button_message: "   " })).show).toBe(false);
    // label だけ設定しても送信文言の代わりにはならない
    expect(resolveCompletionButton(S({ ...base, survey_completion_button_label: "参加する" })).show).toBe(false);
  });

  it("send_line_message 以外の action では message=null（他 action へ漏らさない）", () => {
    const r = resolveCompletionButton(S({
      survey_completion_button_enabled: true,
      survey_completion_button_action:  "close",
      survey_completion_button_message: "送らないで",
    }));
    expect(r).toMatchObject({ show: true, action: "close", message: null });
  });

  it("既存 action は非回帰（message フィールドは null で追加されるだけ）", () => {
    expect(resolveCompletionButton(S({ survey_completion_button_enabled: true })).message).toBeNull();
    expect(resolveCompletionButton(S({
      survey_completion_button_enabled: true,
      survey_completion_button_action:  "open_url",
      survey_completion_button_url:     "https://example.com",
    })).message).toBeNull();
  });
});

describe("validateCompletionButtonSettings", () => {
  it("ボタン無効（未設定 / false）のときは検証しない", () => {
    expect(validateCompletionButtonSettings(undefined).ok).toBe(true);
    expect(validateCompletionButtonSettings(S({})).ok).toBe(true);
    expect(validateCompletionButtonSettings(S({
      survey_completion_button_enabled: false,
      survey_completion_button_action:  "send_line_message", // 未入力でも無効ならエラーにしない
    })).ok).toBe(true);
  });

  it("send_line_message: 送信文言が未入力 / 空白のみ はエラー", () => {
    const r1 = validateCompletionButtonSettings(S({
      survey_completion_button_enabled: true,
      survey_completion_button_action:  "send_line_message",
    }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors.join()).toContain("送信するメッセージ");

    const r2 = validateCompletionButtonSettings(S({
      survey_completion_button_enabled: true,
      survey_completion_button_action:  "send_line_message",
      survey_completion_button_message: "   ",
    }));
    expect(r2.ok).toBe(false);
  });

  it("send_line_message: 送信文言があれば ok", () => {
    expect(validateCompletionButtonSettings(S({
      survey_completion_button_enabled: true,
      survey_completion_button_action:  "send_line_message",
      survey_completion_button_message: "参加を申し込みます",
    })).ok).toBe(true);
  });

  it("最大長超過はエラー（label / message）", () => {
    const longLabel = validateCompletionButtonSettings(S({
      survey_completion_button_enabled: true,
      survey_completion_button_label:   "あ".repeat(SURVEY_COMPLETION_LABEL_MAX + 1),
    }));
    expect(longLabel.ok).toBe(false);

    const longMessage = validateCompletionButtonSettings(S({
      survey_completion_button_enabled: true,
      survey_completion_button_action:  "send_line_message",
      survey_completion_button_message: "あ".repeat(SURVEY_COMPLETION_MESSAGE_MAX + 1),
    }));
    expect(longMessage.ok).toBe(false);
  });

  it("open_url: URL 未設定 / 不正はエラー、正しい URL は ok（既存 action 非回帰）", () => {
    const base = { survey_completion_button_enabled: true, survey_completion_button_action: "open_url" } as const;
    expect(validateCompletionButtonSettings(S({ ...base })).ok).toBe(false);
    expect(validateCompletionButtonSettings(S({ ...base, survey_completion_button_url: "javascript:x" })).ok).toBe(false);
    expect(validateCompletionButtonSettings(S({ ...base, survey_completion_button_url: "https://example.com" })).ok).toBe(true);
  });

  it("liff_home / close は追加入力なしで ok", () => {
    expect(validateCompletionButtonSettings(S({ survey_completion_button_enabled: true })).ok).toBe(true);
    expect(validateCompletionButtonSettings(S({
      survey_completion_button_enabled: true,
      survey_completion_button_action:  "close",
    })).ok).toBe(true);
  });
});

describe("deriveLiffHomeHref", () => {
  it("/.../w/{workPublicId}/p/{pagePublicId} → /.../w/{workPublicId}", () => {
    expect(deriveLiffHomeHref("/liff/w/abc123/p/xyz789")).toBe("/liff/w/abc123");
    expect(deriveLiffHomeHref("/w/abc123/p/xyz789")).toBe("/w/abc123");
    expect(deriveLiffHomeHref("/liff/w/abc123/p/xyz789/")).toBe("/liff/w/abc123");
  });
  it("該当しない形は null", () => {
    expect(deriveLiffHomeHref("/liff/w/abc123")).toBeNull();
    expect(deriveLiffHomeHref("/foo/bar")).toBeNull();
    expect(deriveLiffHomeHref("")).toBeNull();
    expect(deriveLiffHomeHref(null)).toBeNull();
  });
});
