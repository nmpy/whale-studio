/**
 * src/__tests__/locations-tabs.test.ts
 *
 * /locations?tab=... の解決ロジックを検証する。
 * 不正値・null は "gps" にフォールバックすること。
 */

import { describe, it, expect } from "vitest";
import { resolveLocationTab, isValidLocationTab, LOCATION_TABS } from "@/app/oas/[id]/works/[workId]/locations/_tabs-config";

describe("resolveLocationTab", () => {
  it('"gps" / "beacons" / "qr" はそのまま返す', () => {
    expect(resolveLocationTab("gps")).toBe("gps");
    expect(resolveLocationTab("beacons")).toBe("beacons");
    expect(resolveLocationTab("qr")).toBe("qr");
  });

  it("null / undefined は gps にフォールバックする", () => {
    expect(resolveLocationTab(null)).toBe("gps");
    expect(resolveLocationTab(undefined)).toBe("gps");
  });

  it("空文字列・未知の値は gps にフォールバックする", () => {
    expect(resolveLocationTab("")).toBe("gps");
    expect(resolveLocationTab("hoge")).toBe("gps");
    expect(resolveLocationTab("GPS")).toBe("gps"); // 大文字は無効
    expect(resolveLocationTab("beacon")).toBe("gps"); // s なし
  });
});

describe("isValidLocationTab", () => {
  it("正規の値は true", () => {
    expect(isValidLocationTab("gps")).toBe(true);
    expect(isValidLocationTab("beacons")).toBe(true);
    expect(isValidLocationTab("qr")).toBe(true);
  });

  it("不正値は false", () => {
    expect(isValidLocationTab("")).toBe(false);
    expect(isValidLocationTab("hoge")).toBe(false);
    expect(isValidLocationTab(null)).toBe(false);
    expect(isValidLocationTab(undefined)).toBe(false);
  });
});

describe("LOCATION_TABS", () => {
  it("3 タブ（gps / beacons / qr）の順で定義されている", () => {
    expect(LOCATION_TABS.map((t) => t.key)).toEqual(["gps", "beacons", "qr"]);
  });

  it("各タブに表示用ラベル・説明文が設定されている", () => {
    for (const tab of LOCATION_TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
      expect(tab.description.length).toBeGreaterThan(0);
    }
  });
});
