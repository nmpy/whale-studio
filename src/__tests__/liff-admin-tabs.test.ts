/**
 * src/__tests__/liff-admin-tabs.test.ts
 *
 * LIFF 管理画面 /liff?tab=... のタブ解決ロジックを検証する。
 * 不正値・null は "home" にフォールバックすること。
 */

import { describe, it, expect } from "vitest";
import {
  resolveLiffAdminTab,
  isValidLiffAdminTab,
  LIFF_ADMIN_TABS,
} from "@/app/oas/[id]/works/[workId]/liff/_tabs-config";

describe("resolveLiffAdminTab", () => {
  it("正規の値はそのまま返す", () => {
    expect(resolveLiffAdminTab("home")).toBe("home");
    expect(resolveLiffAdminTab("detail")).toBe("detail");
    expect(resolveLiffAdminTab("standalone")).toBe("standalone");
    expect(resolveLiffAdminTab("analytics")).toBe("analytics");
  });

  it("null / undefined は home にフォールバックする", () => {
    expect(resolveLiffAdminTab(null)).toBe("home");
    expect(resolveLiffAdminTab(undefined)).toBe("home");
  });

  it("空文字列・未知の値は home にフォールバックする", () => {
    expect(resolveLiffAdminTab("")).toBe("home");
    expect(resolveLiffAdminTab("hoge")).toBe("home");
    expect(resolveLiffAdminTab("Home")).toBe("home"); // 大文字は無効
  });
});

describe("isValidLiffAdminTab", () => {
  it("正規の値は true", () => {
    expect(isValidLiffAdminTab("home")).toBe(true);
    expect(isValidLiffAdminTab("detail")).toBe(true);
    expect(isValidLiffAdminTab("standalone")).toBe(true);
    expect(isValidLiffAdminTab("analytics")).toBe(true);
  });

  it("不正値は false", () => {
    expect(isValidLiffAdminTab("")).toBe(false);
    expect(isValidLiffAdminTab("hoge")).toBe(false);
    expect(isValidLiffAdminTab(null)).toBe(false);
    expect(isValidLiffAdminTab(undefined)).toBe(false);
  });
});

describe("LIFF_ADMIN_TABS", () => {
  it("4 タブ（home / detail / standalone / analytics）の順で定義されている", () => {
    expect(LIFF_ADMIN_TABS.map((t) => t.key)).toEqual(["home", "detail", "standalone", "analytics"]);
  });

  it("各タブに表示用ラベル・説明文が設定されている", () => {
    for (const tab of LIFF_ADMIN_TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
      expect(tab.description.length).toBeGreaterThan(0);
    }
  });
});
