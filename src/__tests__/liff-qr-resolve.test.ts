// src/__tests__/liff-qr-resolve.test.ts
//
// QR 値パーサ（parseQrValue / qrValuePreview）の unit テスト。
// DB アクセスや認可は route 側の責務なので、ここでは「入力値の構造解析」のみ検証する。

import { describe, it, expect } from "vitest";
import { parseQrValue, qrValuePreview } from "@/lib/liff/qr-resolve";

describe("parseQrValue", () => {
  it("生コード（URL でない）→ code / locationRef にそのまま入る", () => {
    const r = parseQrValue("abc123loc");
    expect(r.isUrl).toBe(false);
    expect(r.code).toBe("abc123loc");
    expect(r.locationRef).toBe("abc123loc");
    expect(r.workRef).toBeNull();
  });

  it("前後空白は trim される", () => {
    const r = parseQrValue("   xyz   ");
    expect(r.locationRef).toBe("xyz");
    expect(r.raw).toBe("xyz");
  });

  it("空文字 → すべて null", () => {
    const r = parseQrValue("");
    expect(r.raw).toBe("");
    expect(r.locationRef).toBeNull();
    expect(r.code).toBeNull();
  });

  it("Whale Studio LIFF URL（query）→ work_id / location_id を抽出", () => {
    const r = parseQrValue("https://app.whale-studio.app/liff?work_id=W1&location_id=L1");
    expect(r.isUrl).toBe(true);
    expect(r.workRef).toBe("W1");
    expect(r.locationRef).toBe("L1");
    expect(r.code).toBeNull();
  });

  it("liff.line.me URL（camelCase query）→ 抽出できる", () => {
    const r = parseQrValue("https://liff.line.me/1234567890?workId=W2&locationId=L2");
    expect(r.workRef).toBe("W2");
    expect(r.locationRef).toBe("L2");
  });

  it("liff.state に退避されたクエリからも抽出する", () => {
    const state = encodeURIComponent("/?work_id=W3&location_id=L3");
    const r = parseQrValue(`https://liff.line.me/1234567890?liff.state=${state}`);
    expect(r.workRef).toBe("W3");
    expect(r.locationRef).toBe("L3");
  });

  it("location 情報の無い URL → locationRef は null（= 後段で unmatched に倒れる）", () => {
    const r = parseQrValue("https://example.com/somewhere");
    expect(r.isUrl).toBe(true);
    expect(r.locationRef).toBeNull();
    expect(r.code).toBeNull();
  });

  it("http/https 以外（javascript: など）は信用しない → locationRef/code とも null", () => {
    const r = parseQrValue("javascript:alert(1)");
    expect(r.locationRef).toBeNull();
    expect(r.code).toBeNull();
  });

  it("他作品向けに見える値でもパーサは抽出するだけ（scope 検証は route 側）", () => {
    // パーサは「候補」を返すのみ。実際に他 work の Location は route の workScope で弾く。
    const r = parseQrValue("https://app.whale-studio.app/liff?work_id=OTHER&location_id=OTHER_LOC");
    expect(r.workRef).toBe("OTHER");
    expect(r.locationRef).toBe("OTHER_LOC");
  });
});

describe("qrValuePreview", () => {
  it("短い値はそのまま", () => {
    expect(qrValuePreview("short")).toBe("short");
  });
  it("長い値は max で切り詰めて … を付ける", () => {
    const long = "x".repeat(100);
    const out = qrValuePreview(long, 10);
    expect(out).toBe(`${"x".repeat(10)}…`);
  });
});
