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
  findDesignatedLiffPage,
} from "@/app/oas/[id]/works/[workId]/liff/_tabs-config";

describe("resolveLiffAdminTab", () => {
  it("正規の値はそのまま返す（survey / faq を含む）", () => {
    expect(resolveLiffAdminTab("home")).toBe("home");
    expect(resolveLiffAdminTab("detail")).toBe("detail");
    expect(resolveLiffAdminTab("standalone")).toBe("standalone");
    expect(resolveLiffAdminTab("survey")).toBe("survey");
    expect(resolveLiffAdminTab("faq")).toBe("faq");
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
  it("正規の値は true（survey / faq を含む）", () => {
    expect(isValidLiffAdminTab("home")).toBe(true);
    expect(isValidLiffAdminTab("detail")).toBe(true);
    expect(isValidLiffAdminTab("standalone")).toBe(true);
    expect(isValidLiffAdminTab("survey")).toBe(true);
    expect(isValidLiffAdminTab("faq")).toBe(true);
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
  it("7 タブ（home / detail / standalone / survey / faq / ticket_link / analytics）の順で定義されている", () => {
    expect(LIFF_ADMIN_TABS.map((t) => t.key)).toEqual([
      "home", "detail", "standalone", "survey", "faq", "ticket_link", "analytics",
    ]);
  });

  it("チケット連携タブが追加され、ラベルが日本語である", () => {
    const tab = LIFF_ADMIN_TABS.find((t) => t.key === "ticket_link");
    expect(tab?.label).toBe("チケット連携");
    expect(tab?.description.length).toBeGreaterThan(0);
  });

  it("survey / faq タブが含まれ、既存 4 タブの key は不変", () => {
    const keys = LIFF_ADMIN_TABS.map((t) => t.key);
    expect(keys).toContain("survey");
    expect(keys).toContain("faq");
    for (const k of ["home", "detail", "standalone", "analytics"]) {
      expect(keys).toContain(k);
    }
  });

  it("各タブに表示用ラベル・説明文が設定されている", () => {
    for (const tab of LIFF_ADMIN_TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
      expect(tab.description.length).toBeGreaterThan(0);
    }
  });
});

describe("findDesignatedLiffPage", () => {
  it("該当 page_type を返す（publish_status 未設定の既存データは選択対象）", () => {
    const pages = [
      { id: "a", page_type: "default" },
      { id: "b", page_type: "survey" },
      { id: "c", page_type: "faq" },
      { id: "d", page_type: "survey" },
    ];
    expect(findDesignatedLiffPage(pages, "survey")?.id).toBe("b");
    expect(findDesignatedLiffPage(pages, "faq")?.id).toBe("c");
  });

  it("published と draft が両方あれば published（の最古）を選ぶ", () => {
    const pages = [
      { id: "d1", page_type: "survey", publish_status: "draft" },
      { id: "p1", page_type: "survey", publish_status: "published" },
      { id: "p2", page_type: "survey", publish_status: "published" },
    ];
    expect(findDesignatedLiffPage(pages, "survey")?.id).toBe("p1");
  });

  it("draft のみなら draft（の最古）を選ぶ", () => {
    const pages = [
      { id: "d1", page_type: "faq", publish_status: "draft" },
      { id: "d2", page_type: "faq", publish_status: "draft" },
    ];
    expect(findDesignatedLiffPage(pages, "faq")?.id).toBe("d1");
  });

  it("archived は選ばない（published/draft を優先）", () => {
    const pages = [
      { id: "ar", page_type: "survey", publish_status: "archived" },
      { id: "dr", page_type: "survey", publish_status: "draft" },
    ];
    expect(findDesignatedLiffPage(pages, "survey")?.id).toBe("dr");
  });

  it("archived しか無ければ null（作成導線へ）", () => {
    const pages = [
      { id: "ar1", page_type: "survey", publish_status: "archived" },
      { id: "ar2", page_type: "survey", publish_status: "archived" },
    ];
    expect(findDesignatedLiffPage(pages, "survey")).toBeNull();
  });

  it("該当なし / 空配列 / 非配列 / null / undefined は null（安全 fallback）", () => {
    expect(findDesignatedLiffPage([{ id: "x", page_type: "default" }], "survey")).toBeNull();
    expect(findDesignatedLiffPage([], "survey")).toBeNull();
    expect(findDesignatedLiffPage(null, "survey")).toBeNull();
    expect(findDesignatedLiffPage(undefined, "faq")).toBeNull();
    // 非配列（万一の不正入力）でも落ちない
    expect(findDesignatedLiffPage("nope" as unknown as Array<{ page_type: string }>, "faq")).toBeNull();
  });
});
