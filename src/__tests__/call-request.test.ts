/**
 * src/__tests__/call-request.test.ts
 *
 * 「通話リクエスト」メッセージ種別の純ロジック検証。
 *   - tel 正規化 / ボタン uri 生成（line_call_url / tel / url）
 *   - Flex 生成（button uri が各タイプで正しい）
 *   - バリデーション（必須・label 上限・通話先必須）
 *   - altText 生成
 */
import { describe, it, expect } from "vitest";
import {
  normalizeCallTel,
  buildCallRequestUri,
  buildCallRequestAltText,
  buildCallRequestFlex,
  validateCallRequestConfig,
  CALL_REQUEST_LABEL_MAX,
  type CallRequestConfig,
} from "@/lib/call-request";

const base: CallRequestConfig = {
  title: "通話リクエスト",
  body: "必要に応じて、下のボタンから通話を開始してください。",
  buttonLabel: "電話をかける",
  callType: "line_call_url",
  lineCallUrl: "https://line.me/call/xxxx",
  tel: "",
  url: "",
  supplement: "",
};

describe("normalizeCallTel", () => {
  it("ハイフン・スペース・括弧を除去して数字のみにする", () => {
    expect(normalizeCallTel("03-1234-5678")).toBe("0312345678");
    expect(normalizeCallTel("(03) 1234 5678")).toBe("0312345678");
  });
  it("先頭 + は保持する", () => {
    expect(normalizeCallTel("+81 3-1234-5678")).toBe("+81312345678");
  });
  it("空/非数字は空文字", () => {
    expect(normalizeCallTel("")).toBe("");
    expect(normalizeCallTel("abc")).toBe("");
    expect(normalizeCallTel(null)).toBe("");
  });
});

describe("buildCallRequestUri", () => {
  it("line_call_url は入力URLをそのまま返す", () => {
    expect(buildCallRequestUri({ ...base, callType: "line_call_url", lineCallUrl: "https://line.me/call/abc" }))
      .toBe("https://line.me/call/abc");
  });
  it("tel は tel: 形式（正規化済み）", () => {
    expect(buildCallRequestUri({ ...base, callType: "tel", tel: "03-1234-5678" })).toBe("tel:0312345678");
    expect(buildCallRequestUri({ ...base, callType: "tel", tel: "+81 3 1234 5678" })).toBe("tel:+81312345678");
  });
  it("url は入力URLをそのまま返す", () => {
    expect(buildCallRequestUri({ ...base, callType: "url", url: "https://example.com/form" }))
      .toBe("https://example.com/form");
  });
  it("必須未入力は null", () => {
    expect(buildCallRequestUri({ ...base, callType: "line_call_url", lineCallUrl: "" })).toBeNull();
    expect(buildCallRequestUri({ ...base, callType: "tel", tel: "" })).toBeNull();
    expect(buildCallRequestUri({ ...base, callType: "url", url: "" })).toBeNull();
  });
});

describe("validateCallRequestConfig", () => {
  it("正常なら null", () => {
    expect(validateCallRequestConfig(base)).toBeNull();
    expect(validateCallRequestConfig({ ...base, callType: "tel", tel: "0312345678", lineCallUrl: "" })).toBeNull();
  });
  it("必須項目未入力はエラー", () => {
    expect(validateCallRequestConfig({ ...base, title: "" })).toMatch(/タイトル/);
    expect(validateCallRequestConfig({ ...base, body: "" })).toMatch(/本文/);
    expect(validateCallRequestConfig({ ...base, buttonLabel: "" })).toMatch(/ボタンラベル/);
  });
  it("ボタンラベルが上限超過はエラー", () => {
    expect(validateCallRequestConfig({ ...base, buttonLabel: "あ".repeat(CALL_REQUEST_LABEL_MAX + 1) })).toMatch(/ボタンラベル/);
  });
  it("通話先が未入力はエラー", () => {
    expect(validateCallRequestConfig({ ...base, callType: "line_call_url", lineCallUrl: "" })).toMatch(/LINEコールURL/);
    expect(validateCallRequestConfig({ ...base, callType: "tel", tel: "" })).toMatch(/電話番号/);
    expect(validateCallRequestConfig({ ...base, callType: "url", url: "" })).toMatch(/URL/);
  });
});

describe("buildCallRequestAltText", () => {
  it("明示 alt → タイトル → 既定 の優先順位", () => {
    expect(buildCallRequestAltText(base, "明示alt")).toBe("明示alt");
    expect(buildCallRequestAltText(base)).toBe("通話リクエスト");
    expect(buildCallRequestAltText({ ...base, title: "" })).toBe("通話リクエスト");
  });
});

describe("buildCallRequestFlex", () => {
  function footerButtonAction(contents: Record<string, unknown>): Record<string, unknown> | undefined {
    const footer = contents.footer as { contents?: { action?: Record<string, unknown> }[] } | undefined;
    return footer?.contents?.[0]?.action;
  }

  it("line_call_url: button uri に入力URLが入る", () => {
    const json = JSON.stringify({ ...base, callType: "line_call_url", lineCallUrl: "https://line.me/call/abc" });
    const flex = buildCallRequestFlex(json, null);
    expect(flex).not.toBeNull();
    const action = footerButtonAction(flex!.contents);
    expect(action?.type).toBe("uri");
    expect(action?.uri).toBe("https://line.me/call/abc");
    expect(action?.label).toBe("電話をかける");
    expect(flex!.altText).toBe("通話リクエスト");
  });

  it("tel: button uri が tel: 形式になる", () => {
    const json = JSON.stringify({ ...base, callType: "tel", tel: "03-1234-5678", lineCallUrl: "" });
    const flex = buildCallRequestFlex(json, null);
    expect(footerButtonAction(flex!.contents)?.uri).toBe("tel:0312345678");
  });

  it("url: button uri に入力URLが入る", () => {
    const json = JSON.stringify({ ...base, callType: "url", url: "https://example.com/x", lineCallUrl: "" });
    const flex = buildCallRequestFlex(json, null);
    expect(footerButtonAction(flex!.contents)?.uri).toBe("https://example.com/x");
  });

  it("補足テキストがあれば body に追加される", () => {
    const json = JSON.stringify({ ...base, supplement: "スタッフが対応できない場合があります" });
    const flex = buildCallRequestFlex(json, null);
    const body = flex!.contents.body as { contents: { text?: string }[] };
    expect(body.contents.some((c) => c.text === "スタッフが対応できない場合があります")).toBe(true);
  });

  it("通話先未入力/不正 JSON は null（送信側で text フォールバック）", () => {
    expect(buildCallRequestFlex(JSON.stringify({ ...base, lineCallUrl: "" }), null)).toBeNull();
    expect(buildCallRequestFlex("not-json", null)).toBeNull();
    expect(buildCallRequestFlex(null, null)).toBeNull();
  });
});
