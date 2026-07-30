// src/__tests__/survey-completion.test.ts
// アンケート「回答後の挙動」純関数の単体（既定補完・URL 妥当性・ホーム導出・複数回答/回答済み判定）。
import { describe, it, expect } from "vitest";
import {
  resolveCompletionButton,
  resolveAlreadyAnsweredMessage,
  isMultipleAllowed,
  isSafeExternalUrl,
  deriveLiffHomeHref,
  SURVEY_ALREADY_ANSWERED_DEFAULT,
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
