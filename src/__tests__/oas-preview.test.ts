/**
 * src/__tests__/oas-preview.test.ts
 *
 * src/lib/oas-preview.ts の純関数 helper を検証する。
 *
 * 検証観点:
 *   - parseOasViewRole: 許可値だけ通す / 不正値は null
 *   - viewingAsPlatformOwner / canCreateOaInView:
 *       実 platform owner かつ platform_owner 視点のときのみ true
 *       非 platform owner は preview を完全無視 (= 常に false)
 *   - isPreviewingOasView: owner 以外の視点を選択中のみ true
 *   - previewWsRoleOf: preview 中の workspace role のみ Role として返す
 */

import { describe, it, expect } from "vitest";
import {
  parseOasViewRole,
  viewingAsPlatformOwner,
  canCreateOaInView,
  isPreviewingOasView,
  previewWsRoleOf,
  viewingAsOwnerOrAbove,
  OAS_VIEW_ROLES,
} from "@/lib/oas-preview";

// ──────────────────────────────────────────────────────────
// parseOasViewRole
// ──────────────────────────────────────────────────────────

describe("parseOasViewRole", () => {
  it("許可値はそのまま返す", () => {
    for (const r of OAS_VIEW_ROLES) {
      expect(parseOasViewRole(r)).toBe(r);
    }
  });

  it("前後空白は trim する", () => {
    expect(parseOasViewRole(" admin ")).toBe("admin");
  });

  it("不正値 / null / undefined / 空文字は null", () => {
    expect(parseOasViewRole("super")).toBeNull();
    expect(parseOasViewRole("tester")).toBeNull(); // /oas では区別しない設計
    expect(parseOasViewRole("user")).toBeNull();   // PlatformRole の値は別物
    expect(parseOasViewRole(null)).toBeNull();
    expect(parseOasViewRole(undefined)).toBeNull();
    expect(parseOasViewRole("")).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────
// viewingAsPlatformOwner / canCreateOaInView（= 同義）
// ──────────────────────────────────────────────────────────

describe("viewingAsPlatformOwner", () => {
  it("実 platform owner かつ preview 未指定 → true", () => {
    expect(viewingAsPlatformOwner({ isPlatformOwner: true, previewViewRole: null })).toBe(true);
  });

  it("実 platform owner かつ platform_owner 視点 → true", () => {
    expect(viewingAsPlatformOwner({ isPlatformOwner: true, previewViewRole: "platform_owner" })).toBe(true);
  });

  it("実 platform owner が owner/admin/editor/viewer 視点を選ぶと → false", () => {
    for (const r of ["owner", "admin", "editor", "viewer"] as const) {
      expect(viewingAsPlatformOwner({ isPlatformOwner: true, previewViewRole: r })).toBe(false);
    }
  });

  it("非 platform owner は preview 値に関係なく常に false (= preview を完全無視)", () => {
    expect(viewingAsPlatformOwner({ isPlatformOwner: false, previewViewRole: null })).toBe(false);
    expect(viewingAsPlatformOwner({ isPlatformOwner: false, previewViewRole: "platform_owner" })).toBe(false);
    expect(viewingAsPlatformOwner({ isPlatformOwner: false, previewViewRole: "owner" })).toBe(false);
  });
});

describe("canCreateOaInView (= 「+ アカウントを追加」表示条件)", () => {
  it("platform owner 視点のときのみ表示", () => {
    expect(canCreateOaInView({ isPlatformOwner: true, previewViewRole: null })).toBe(true);
    expect(canCreateOaInView({ isPlatformOwner: true, previewViewRole: "platform_owner" })).toBe(true);
  });

  it("owner/admin/editor/viewer 視点では非表示", () => {
    for (const r of ["owner", "admin", "editor", "viewer"] as const) {
      expect(canCreateOaInView({ isPlatformOwner: true, previewViewRole: r })).toBe(false);
    }
  });

  it("非 platform owner では常に非表示", () => {
    expect(canCreateOaInView({ isPlatformOwner: false, previewViewRole: null })).toBe(false);
    expect(canCreateOaInView({ isPlatformOwner: false, previewViewRole: "owner" })).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// isPreviewingOasView
// ──────────────────────────────────────────────────────────

describe("isPreviewingOasView", () => {
  it("platform owner が owner 以外の視点を選択中のみ true", () => {
    expect(isPreviewingOasView({ isPlatformOwner: true, previewViewRole: "viewer" })).toBe(true);
    expect(isPreviewingOasView({ isPlatformOwner: true, previewViewRole: "owner" })).toBe(true);
  });

  it("platform_owner 視点 / 未指定 は preview 中ではない", () => {
    expect(isPreviewingOasView({ isPlatformOwner: true, previewViewRole: null })).toBe(false);
    expect(isPreviewingOasView({ isPlatformOwner: true, previewViewRole: "platform_owner" })).toBe(false);
  });

  it("非 platform owner は常に preview 中ではない", () => {
    expect(isPreviewingOasView({ isPlatformOwner: false, previewViewRole: "viewer" })).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// previewWsRoleOf
// ──────────────────────────────────────────────────────────

describe("previewWsRoleOf", () => {
  it("preview 中の workspace role を Role として返す", () => {
    expect(previewWsRoleOf({ isPlatformOwner: true, previewViewRole: "admin" })).toBe("admin");
    expect(previewWsRoleOf({ isPlatformOwner: true, previewViewRole: "viewer" })).toBe("viewer");
  });

  it("platform_owner / 未指定 / 非 platform owner は null", () => {
    expect(previewWsRoleOf({ isPlatformOwner: true, previewViewRole: "platform_owner" })).toBeNull();
    expect(previewWsRoleOf({ isPlatformOwner: true, previewViewRole: null })).toBeNull();
    expect(previewWsRoleOf({ isPlatformOwner: false, previewViewRole: "admin" })).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────
// viewingAsOwnerOrAbove (= 利用区分など owner 向け情報の表示判定)
// ──────────────────────────────────────────────────────────

describe("viewingAsOwnerOrAbove", () => {
  it("platform owner の platform_owner / owner 視点では true", () => {
    expect(viewingAsOwnerOrAbove({ isPlatformOwner: true, previewViewRole: null })).toBe(true);
    expect(viewingAsOwnerOrAbove({ isPlatformOwner: true, previewViewRole: "platform_owner" })).toBe(true);
    expect(viewingAsOwnerOrAbove({ isPlatformOwner: true, previewViewRole: "owner" })).toBe(true);
  });

  it("admin / editor / viewer を表示確認中は false (= 非オーナー視点には出さない)", () => {
    expect(viewingAsOwnerOrAbove({ isPlatformOwner: true, previewViewRole: "admin" })).toBe(false);
    expect(viewingAsOwnerOrAbove({ isPlatformOwner: true, previewViewRole: "editor" })).toBe(false);
    expect(viewingAsOwnerOrAbove({ isPlatformOwner: true, previewViewRole: "viewer" })).toBe(false);
  });

  it("非 platform owner は常に false (= 一般ユーザーは my_role で別途判定する)", () => {
    expect(viewingAsOwnerOrAbove({ isPlatformOwner: false, previewViewRole: null })).toBe(false);
    expect(viewingAsOwnerOrAbove({ isPlatformOwner: false, previewViewRole: "owner" })).toBe(false);
  });
});
