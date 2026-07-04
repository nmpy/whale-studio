/**
 * src/__tests__/access-preview.test.ts
 *
 * src/lib/access-preview.ts の純関数 helper を検証する。
 *
 * 検証観点:
 *   - parsePreviewPlan: 許可値だけ通す / 不正値は null
 *   - parsePreviewRole: 同上
 *   - getEffectivePlan: owner のみ override / 不正値 / 未指定で real fallback
 *   - getEffectiveRole: 同上
 *   - buildPreviewSearchParams: 既存 query 保持 / 値の追加・削除
 */

import { describe, it, expect } from "vitest";
import {
  parsePreviewPlan,
  parsePreviewRole,
  getEffectivePlan,
  getEffectiveRole,
  buildPreviewSearchParams,
  withPreviewParams,
} from "@/lib/access-preview";

// ──────────────────────────────────────────────────────────
// parsePreviewPlan
// ──────────────────────────────────────────────────────────

describe("parsePreviewPlan", () => {
  it("許可値はそのまま返す", () => {
    expect(parsePreviewPlan("basic")).toBe("basic");
    expect(parsePreviewPlan("standard")).toBe("standard");
    expect(parsePreviewPlan("plus")).toBe("plus");
    expect(parsePreviewPlan("pro")).toBe("pro");
  });

  it("大文字 / 前後空白は normalize する", () => {
    expect(parsePreviewPlan("BASIC")).toBe("basic");
    expect(parsePreviewPlan(" Pro ")).toBe("pro");
  });

  it("不正値 / null / undefined / 空文字は null", () => {
    expect(parsePreviewPlan("super")).toBeNull();
    expect(parsePreviewPlan(null)).toBeNull();
    expect(parsePreviewPlan(undefined)).toBeNull();
    expect(parsePreviewPlan("")).toBeNull();
    expect(parsePreviewPlan("admin")).toBeNull(); // role 値を入れても null
  });
});

// ──────────────────────────────────────────────────────────
// parsePreviewRole
// ──────────────────────────────────────────────────────────

describe("parsePreviewRole", () => {
  it("許可値はそのまま返す", () => {
    expect(parsePreviewRole("owner")).toBe("owner");
    expect(parsePreviewRole("admin")).toBe("admin");
    expect(parsePreviewRole("editor")).toBe("editor");
    expect(parsePreviewRole("operator")).toBe("operator");
    expect(parsePreviewRole("viewer")).toBe("viewer");
    expect(parsePreviewRole("client_operator")).toBe("client_operator");
  });

  it("大文字 / 前後空白は normalize する", () => {
    expect(parsePreviewRole("OWNER")).toBe("owner");
    expect(parsePreviewRole(" client_operator ")).toBe("client_operator");
  });

  it("不正値 / 既存 WorkspaceRole (tester) でない (= preview 専用なら無視) ものは null", () => {
    expect(parsePreviewRole("super")).toBeNull();
    expect(parsePreviewRole("guest")).toBeNull();
    expect(parsePreviewRole("")).toBeNull();
    expect(parsePreviewRole(null)).toBeNull();
    // 注: "tester" は preview role には含めない設計 (= owner/admin/editor/operator/viewer/client_operator のみ)
    expect(parsePreviewRole("tester")).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────
// getEffectivePlan
// ──────────────────────────────────────────────────────────

describe("getEffectivePlan", () => {
  it("owner かつ preview 指定があれば preview を返す", () => {
    expect(getEffectivePlan({
      realPlan: "pro", previewPlan: "basic", canUsePreviewMode: true,
    })).toBe("basic");
  });

  it("owner かつ preview 未指定なら real を返す", () => {
    expect(getEffectivePlan({
      realPlan: "pro", previewPlan: null, canUsePreviewMode: true,
    })).toBe("pro");
  });

  it("owner でない (= canUsePreviewMode=false) は preview を完全無視", () => {
    expect(getEffectivePlan({
      realPlan: "basic", previewPlan: "pro", canUsePreviewMode: false,
    })).toBe("basic");
  });

  it("実プラン Pro / preview Plus → Plus を返す", () => {
    expect(getEffectivePlan({
      realPlan: "pro", previewPlan: "plus", canUsePreviewMode: true,
    })).toBe("plus");
  });

  it("実プラン Pro / preview Standard → Standard", () => {
    expect(getEffectivePlan({
      realPlan: "pro", previewPlan: "standard", canUsePreviewMode: true,
    })).toBe("standard");
  });

  it("実プラン Pro / preview Pro (= 同じ) → Pro", () => {
    expect(getEffectivePlan({
      realPlan: "pro", previewPlan: "pro", canUsePreviewMode: true,
    })).toBe("pro");
  });
});

// ──────────────────────────────────────────────────────────
// getEffectiveRole
// ──────────────────────────────────────────────────────────

describe("getEffectiveRole", () => {
  it("owner かつ preview 指定があれば preview を返す", () => {
    expect(getEffectiveRole({
      realRole: "owner" as const, previewRole: "client_operator",
      canUsePreviewMode: true,
    })).toBe("client_operator");
  });

  it("owner かつ preview 未指定なら real を返す", () => {
    expect(getEffectiveRole({
      realRole: "owner" as const, previewRole: null,
      canUsePreviewMode: true,
    })).toBe("owner");
  });

  it("canUsePreviewMode=false は preview を完全無視", () => {
    expect(getEffectiveRole({
      realRole: "viewer" as const, previewRole: "owner",
      canUsePreviewMode: false,
    })).toBe("viewer");
  });

  it("realRole が null でも問題なく動作 (= ログイン直後 / role 未取得)", () => {
    expect(getEffectiveRole({
      realRole: null, previewRole: null, canUsePreviewMode: true,
    })).toBeNull();
    expect(getEffectiveRole({
      realRole: null, previewRole: "editor", canUsePreviewMode: true,
    })).toBe("editor");
  });
});

// ──────────────────────────────────────────────────────────
// buildPreviewSearchParams
// ──────────────────────────────────────────────────────────

describe("buildPreviewSearchParams", () => {
  it("既存 query は保持される", () => {
    const current = new URLSearchParams("tab=data&foo=bar");
    const next = buildPreviewSearchParams(current, { previewPlan: "basic" });
    expect(next.get("tab")).toBe("data");
    expect(next.get("foo")).toBe("bar");
    expect(next.get("previewPlan")).toBe("basic");
  });

  it("値 null で削除される", () => {
    const current = new URLSearchParams("previewPlan=basic&previewRole=editor&tab=data");
    const next = buildPreviewSearchParams(current, { previewPlan: null });
    expect(next.get("previewPlan")).toBeNull();
    expect(next.get("previewRole")).toBe("editor");  // 触っていない
    expect(next.get("tab")).toBe("data");
  });

  it("undefined は触らない", () => {
    const current = new URLSearchParams("previewPlan=basic");
    const next = buildPreviewSearchParams(current, { previewRole: "viewer" });
    expect(next.get("previewPlan")).toBe("basic");
    expect(next.get("previewRole")).toBe("viewer");
  });

  it("両方 null で両方クリア", () => {
    const current = new URLSearchParams("previewPlan=basic&previewRole=viewer&keep=1");
    const next = buildPreviewSearchParams(current, { previewPlan: null, previewRole: null });
    expect(next.get("previewPlan")).toBeNull();
    expect(next.get("previewRole")).toBeNull();
    expect(next.get("keep")).toBe("1");
  });
});

// ──────────────────────────────────────────────────────────
// 統合シナリオ
// ──────────────────────────────────────────────────────────

describe("統合シナリオ", () => {
  it("owner 以外が ?previewPlan=pro を付けても無視される (= real が basic ならそのまま basic)", () => {
    const plan = getEffectivePlan({
      realPlan: "basic",
      previewPlan: parsePreviewPlan("pro"),
      canUsePreviewMode: false,  // ← owner じゃない
    });
    expect(plan).toBe("basic");
  });

  it("owner が ?previewPlan=invalid を付けても real のまま", () => {
    const plan = getEffectivePlan({
      realPlan: "pro",
      previewPlan: parsePreviewPlan("invalid"),
      canUsePreviewMode: true,
    });
    expect(plan).toBe("pro");
  });

  it("owner が ?previewPlan=basic&previewRole=client_operator を付けた場合", () => {
    expect(getEffectivePlan({
      realPlan: "pro",
      previewPlan: parsePreviewPlan("basic"),
      canUsePreviewMode: true,
    })).toBe("basic");
    expect(getEffectiveRole({
      realRole: "owner" as const,
      previewRole: parsePreviewRole("client_operator"),
      canUsePreviewMode: true,
    })).toBe("client_operator");
  });

  it("解除 (= 両方クリア) で real に戻る", () => {
    const cleared = buildPreviewSearchParams(
      new URLSearchParams("previewPlan=basic&previewRole=viewer"),
      { previewPlan: null, previewRole: null },
    );
    expect(cleared.toString()).toBe("");
  });
});

// ──────────────────────────────────────────────────────────
// withPreviewParams (= 遷移先 href に preview を持ち越す)
// ──────────────────────────────────────────────────────────

describe("withPreviewParams", () => {
  it("preview なし → pathname をそのまま返す", () => {
    expect(withPreviewParams("/oas/x/works/y/liff", new URLSearchParams())).toBe(
      "/oas/x/works/y/liff",
    );
  });

  it("previewPlan のみあり → ?previewPlan=... を付与", () => {
    expect(
      withPreviewParams("/oas/x/works/y/liff", new URLSearchParams("previewPlan=basic"))
    ).toBe("/oas/x/works/y/liff?previewPlan=basic");
  });

  it("previewPlan + previewRole → 両方付与", () => {
    expect(
      withPreviewParams(
        "/oas/x/works/y/audience",
        new URLSearchParams("previewPlan=standard&previewRole=client_operator"),
      )
    ).toBe("/oas/x/works/y/audience?previewPlan=standard&previewRole=client_operator");
  });

  it("preview 以外の query (= tab 等) は持ち越さない", () => {
    // 遷移先 page では別の意味になるため安全側で落とす
    const result = withPreviewParams(
      "/oas/x/works/y/liff",
      new URLSearchParams("previewPlan=basic&tab=draft&foo=bar"),
    );
    expect(result).toBe("/oas/x/works/y/liff?previewPlan=basic");
  });

  it("pathname に既に ? があれば & で連結", () => {
    expect(
      withPreviewParams(
        "/oas/x/audience?tab=segments",
        new URLSearchParams("previewPlan=basic"),
      )
    ).toBe("/oas/x/audience?tab=segments&previewPlan=basic");
  });

  it("searchParams が null / undefined → pathname のまま", () => {
    expect(withPreviewParams("/foo", null)).toBe("/foo");
    expect(withPreviewParams("/foo", undefined)).toBe("/foo");
  });
});

// ────────────────────────────────────────────────
// withPreviewParams: 遷移先が明示する query を優先（重複させない）
// ────────────────────────────────────────────────
describe("withPreviewParams — 遷移先の明示 query を優先", () => {
  it("遷移先が既に previewPlan を持つ → 遷移先を優先（現在値で上書きしない・重複キーを作らない）", () => {
    const out = withPreviewParams("/oas/x?previewPlan=pro", new URLSearchParams("previewPlan=basic"));
    expect(out).toBe("/oas/x?previewPlan=pro");
  });

  it("遷移先が previewRole を持ち、現在 previewPlan がある → role は遷移先優先・plan は引き継ぎ", () => {
    const out = withPreviewParams(
      "/oas/x?previewRole=viewer",
      new URLSearchParams("previewPlan=basic&previewRole=owner"),
    );
    // 既存 role=viewer を維持しつつ plan=basic を追加
    expect(out).toBe("/oas/x?previewRole=viewer&previewPlan=basic");
  });

  it("遷移先の非 preview query は保持したまま preview を引き継ぐ", () => {
    const out = withPreviewParams("/oas/x/audience?tab=data", new URLSearchParams("previewRole=editor"));
    expect(out).toBe("/oas/x/audience?tab=data&previewRole=editor");
  });
});
