// src/__tests__/rh-e2e/call-request.e2e.ts
// Call Request の runtime 生成 E2E（§9）。CMS 保存 schema 単体でなく、
// runtime が flex_payload_json から実際に生成する Flex/URI を確認する。
// 不正データでも throw/500 にならない（null で drop）ことを重点確認。
import { describe, it, expect } from "vitest";
import {
  buildCallRequestUri, buildCallRequestFlex, buildCallRequestAltText,
  classifyCallRequestConfig, validateCallRequestConfig, normalizeCallTel,
} from "@/lib/call-request";

const base = { title: "電話", body: "お電話ください", buttonLabel: "発信" };
const json = (o: unknown) => JSON.stringify(o);

describe("call request URI generation", () => {
  it("tel: 正規化した tel: URI を生成", () => {
    expect(buildCallRequestUri({ ...base, callType: "tel", tel: "03-1234-5678" } as never)).toBe("tel:0312345678");
    expect(buildCallRequestUri({ ...base, callType: "tel", tel: "+81 90 1234 5678" } as never)).toBe("tel:+819012345678");
  });
  it("line_call_url / url: そのまま URI", () => {
    expect(buildCallRequestUri({ ...base, callType: "line_call_url", lineCallUrl: "https://line.me/call/x" } as never)).toBe("https://line.me/call/x");
    expect(buildCallRequestUri({ ...base, callType: "url", url: "https://example.com" } as never)).toBe("https://example.com");
  });
  it("必須未入力（空 tel / 空 url）→ null（生成不可）", () => {
    expect(buildCallRequestUri({ ...base, callType: "tel", tel: "" } as never)).toBeNull();
    expect(buildCallRequestUri({ ...base, callType: "tel", tel: "---" } as never)).toBeNull();
    expect(buildCallRequestUri({ ...base, callType: "url", url: "" } as never)).toBeNull();
  });
});

describe("call request Flex generation (runtime)", () => {
  it("正常設定 → bubble Flex + altText + uri action を生成", () => {
    const flex = buildCallRequestFlex(json({ ...base, callType: "tel", tel: "0312345678", supplement: "9-18時" }));
    expect(flex).not.toBeNull();
    expect(flex?.contents.type).toBe("bubble");
    expect(typeof flex?.altText).toBe("string");
    // Flex 内に uri action が含まれる（JSON 走査で tel: を検出）
    expect(JSON.stringify(flex?.contents)).toContain("tel:0312345678");
  });

  it("空設定 → null（送信 drop・throw しない）", () => {
    expect(buildCallRequestFlex("")).toBeNull();
    expect(buildCallRequestFlex(null)).toBeNull();
    expect(buildCallRequestFlex(undefined)).toBeNull();
  });

  it("malformed JSON → null（throw しない・500 化しない）", () => {
    expect(() => buildCallRequestFlex("{ not json")).not.toThrow();
    expect(buildCallRequestFlex("{ not json")).toBeNull();
  });

  it("uri 不能設定（tel 空）→ null（LINE 制約違反 payload を生成しない）", () => {
    expect(buildCallRequestFlex(json({ ...base, callType: "tel", tel: "" }))).toBeNull();
  });

  it("同一設定を複数回生成しても安定（決定的・serialize/deserialize 相当）", () => {
    const cfg = json({ ...base, callType: "url", url: "https://example.com" });
    const a = buildCallRequestFlex(cfg);
    const b = buildCallRequestFlex(cfg);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("call request config classification (slot 不正データの安全分類)", () => {
  it("empty / invalid_json / invalid_config / ok を正しく分類", () => {
    expect(classifyCallRequestConfig(null)).toBe("empty");
    expect(classifyCallRequestConfig("")).toBe("empty");
    expect(classifyCallRequestConfig("{ broken")).toBe("invalid_json");
    expect(classifyCallRequestConfig(json({ title: "", body: "", buttonLabel: "" }))).toBe("invalid_config");
    expect(classifyCallRequestConfig(json({ ...base, callType: "url", url: "https://x" }))).toBe("ok");
  });

  it("validateCallRequestConfig: 必須欠落を検出", () => {
    expect(validateCallRequestConfig(null)).not.toBeNull();
    expect(validateCallRequestConfig({ title: "t", body: "b", buttonLabel: "l", callType: "tel", tel: "" })).not.toBeNull();
    expect(validateCallRequestConfig({ title: "t", body: "b", buttonLabel: "l", callType: "url", url: "https://x" })).toBeNull();
  });

  it("altText は上限内・既定フォールバック", () => {
    expect(buildCallRequestAltText({ ...base, title: "" } as never)).toBe("通話リクエスト");
    expect(normalizeCallTel("(03) 1234-5678")).toBe("0312345678");
  });
});
