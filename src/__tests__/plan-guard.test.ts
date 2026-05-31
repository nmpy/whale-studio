/**
 * src/__tests__/plan-guard.test.ts
 *
 * src/lib/plan-guard.ts のサーバ helper を検証する。
 *
 * 検証:
 *   1. getCurrentPlanTierForOa — Subscription を引いて tier に正規化
 *   2. getCurrentPlanTierForWork — work → OA を解決してから tier 算出
 *   3. requirePlanFeature — plan / featureKey から ok / 403 判定
 *
 * 受け入れ条件 (= ユーザー指定の最低限):
 *   - Basic で audience API → PLAN_REQUIRED
 *   - Standard で audience → allowed
 *   - Standard で liffDisplay → PLAN_REQUIRED
 *   - Plus で liffDisplay / destinations → allowed
 *   - Plus で location → PLAN_REQUIRED
 *   - Pro で location → allowed
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── モック ───────────────────────────────────────────────
// vi.mock 内で参照する変数は vi.hoisted で先に巻き上げる (= TDZ 回避)
const { mockSubscription, mockGetOaIdFromWorkId } = vi.hoisted(() => ({
  mockSubscription:      { findUnique: vi.fn() },
  mockGetOaIdFromWorkId: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { subscription: mockSubscription },
}));

vi.mock("@/lib/rbac", () => ({
  getOaIdFromWorkId: (...args: unknown[]) => mockGetOaIdFromWorkId(...args),
}));

// FEATURE は実物を import (= 純定数)
import { FEATURE } from "@/lib/constants/plans";
import {
  getCurrentPlanTierForOa,
  getCurrentPlanTierForWork,
  requirePlanFeature,
} from "@/lib/plan-guard";

// ──────────────────────────────────────────────────────────
// getCurrentPlanTierForOa
// ──────────────────────────────────────────────────────────

describe("getCurrentPlanTierForOa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Subscription あり (= status active / tester) → basic", async () => {
    mockSubscription.findUnique.mockResolvedValue({ status: "active", plan: { name: "tester" } });
    expect(await getCurrentPlanTierForOa("oa-1")).toBe("basic");
  });

  it("Subscription あり (= status active / editor) → pro", async () => {
    mockSubscription.findUnique.mockResolvedValue({ status: "active", plan: { name: "editor" } });
    expect(await getCurrentPlanTierForOa("oa-1")).toBe("pro");
  });

  it("Subscription あり (= status trialing / plus) → plus (= trialing も full access)", async () => {
    mockSubscription.findUnique.mockResolvedValue({ status: "trialing", plan: { name: "plus" } });
    expect(await getCurrentPlanTierForOa("oa-1")).toBe("plus");
  });

  it("Subscription あり (= 4 ティア名そのまま, status active) → そのまま返る", async () => {
    mockSubscription.findUnique.mockResolvedValue({ status: "active", plan: { name: "plus" } });
    expect(await getCurrentPlanTierForOa("oa-1")).toBe("plus");
  });

  it("Subscription なし (= null) → basic に fallback", async () => {
    mockSubscription.findUnique.mockResolvedValue(null);
    expect(await getCurrentPlanTierForOa("oa-1")).toBe("basic");
  });

  it("oaId が空 → DB を引かずに basic", async () => {
    expect(await getCurrentPlanTierForOa("")).toBe("basic");
    expect(mockSubscription.findUnique).not.toHaveBeenCalled();
  });

  it("DB エラーで例外 → basic に fallback (= 機能解放しない)", async () => {
    mockSubscription.findUnique.mockRejectedValue(new Error("db down"));
    expect(await getCurrentPlanTierForOa("oa-1")).toBe("basic");
  });

  // ── status による full-access 制御 ──
  // active / trialing 以外は plan 名を無視して basic にフォールバック (= 課金状態と権限を一致させる)。
  it.each([
    ["past_due",           "pro"],
    ["canceled",           "pro"],
    ["unpaid",             "plus"],
    ["incomplete",         "plus"],
    ["incomplete_expired", "pro"],
    ["paused",             "standard"],
    ["unknown_status",     "pro"],
  ])("status='%s' (= 非アクティブ) なら plan='%s' でも basic にフォールバック", async (status, planName) => {
    mockSubscription.findUnique.mockResolvedValue({ status, plan: { name: planName } });
    expect(await getCurrentPlanTierForOa("oa-1")).toBe("basic");
  });
});

// ──────────────────────────────────────────────────────────
// getCurrentPlanTierForWork
// ──────────────────────────────────────────────────────────

describe("getCurrentPlanTierForWork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("work → OA → Subscription を解決して tier を返す", async () => {
    mockGetOaIdFromWorkId.mockResolvedValue("oa-1");
    mockSubscription.findUnique.mockResolvedValue({ status: "active", plan: { name: "editor" } });
    expect(await getCurrentPlanTierForWork("w1")).toBe("pro");
  });

  it("work 経由でも status 非アクティブなら basic にフォールバック", async () => {
    mockGetOaIdFromWorkId.mockResolvedValue("oa-1");
    mockSubscription.findUnique.mockResolvedValue({ status: "canceled", plan: { name: "editor" } });
    expect(await getCurrentPlanTierForWork("w1")).toBe("basic");
  });

  it("work から OA が引けない → basic fallback", async () => {
    mockGetOaIdFromWorkId.mockResolvedValue(null);
    expect(await getCurrentPlanTierForWork("w-missing")).toBe("basic");
    expect(mockSubscription.findUnique).not.toHaveBeenCalled();
  });

  it("workId が空 → basic fallback", async () => {
    expect(await getCurrentPlanTierForWork("")).toBe("basic");
  });
});

// ──────────────────────────────────────────────────────────
// requirePlanFeature — ユーザー指定の受け入れ条件
// ──────────────────────────────────────────────────────────

describe("requirePlanFeature — feature × plan の判定", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** plan = `name` の OA (= status="active") で featureKey を試す共通ヘルパー */
  async function tryAccess(planName: string, featureKey: typeof FEATURE[keyof typeof FEATURE]) {
    mockSubscription.findUnique.mockResolvedValue({ status: "active", plan: { name: planName } });
    return requirePlanFeature({ oaId: "oa-1", featureKey });
  }

  it("Basic (= tester) で audience → 403 PLAN_REQUIRED", async () => {
    const result = await tryAccess("tester", FEATURE.audience);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      const body = await result.response.json();
      expect(body.error.code).toBe("PLAN_REQUIRED");
      expect(body.error.details.requiredPlan).toBe("standard");
      expect(body.error.details.requiredPlanLabel).toBe("Standard");
      expect(body.error.message).toContain("Standard");
    }
  });

  it("Standard で audience → allowed", async () => {
    const result = await tryAccess("standard", FEATURE.audience);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan).toBe("standard");
  });

  it("Standard で liffDisplay → 403 PLAN_REQUIRED (Plus 必要)", async () => {
    const result = await tryAccess("standard", FEATURE.liffDisplay);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      expect(body.error.code).toBe("PLAN_REQUIRED");
      expect(body.error.details.requiredPlanLabel).toBe("Plus");
    }
  });

  it("Plus で liffDisplay → allowed", async () => {
    const result = await tryAccess("plus", FEATURE.liffDisplay);
    expect(result.ok).toBe(true);
  });

  it("Plus で destinations → allowed", async () => {
    const result = await tryAccess("plus", FEATURE.destinations);
    expect(result.ok).toBe(true);
  });

  it("Plus で location → 403 PLAN_REQUIRED (Pro Max 必要)", async () => {
    const result = await tryAccess("plus", FEATURE.location);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      expect(body.error.details.requiredPlanLabel).toBe("Pro Max");
    }
  });

  it("Pro Max (= editor) で location → allowed", async () => {
    const result = await tryAccess("editor", FEATURE.location);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan).toBe("pro");
  });

  it("workId 経由でも判定できる (= getOaIdFromWorkId を通る)", async () => {
    mockGetOaIdFromWorkId.mockResolvedValue("oa-2");
    mockSubscription.findUnique.mockResolvedValue({ status: "active", plan: { name: "tester" } });
    const result = await requirePlanFeature({ workId: "w-1", featureKey: FEATURE.location });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      expect(body.error.details.requiredPlanLabel).toBe("Pro Max");
    }
  });

  // ── status による full-access 制御 (= requirePlanFeature 経由) ──
  it("status='active' + Plus plan で destinations → allowed", async () => {
    mockSubscription.findUnique.mockResolvedValue({ status: "active", plan: { name: "plus" } });
    const result = await requirePlanFeature({ oaId: "oa-1", featureKey: FEATURE.destinations });
    expect(result.ok).toBe(true);
  });

  it("status='canceled' + Plus plan で destinations → 403 PLAN_REQUIRED (= basic にダウングレード)", async () => {
    mockSubscription.findUnique.mockResolvedValue({ status: "canceled", plan: { name: "plus" } });
    const result = await requirePlanFeature({ oaId: "oa-1", featureKey: FEATURE.destinations });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      expect(body.error.code).toBe("PLAN_REQUIRED");
      expect(body.error.details.requiredPlanLabel).toBe("Plus");
    }
  });

  it("status='past_due' + Pro plan で location → 403 PLAN_REQUIRED", async () => {
    mockSubscription.findUnique.mockResolvedValue({ status: "past_due", plan: { name: "editor" } });
    const result = await requirePlanFeature({ oaId: "oa-1", featureKey: FEATURE.location });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.json();
      expect(body.error.code).toBe("PLAN_REQUIRED");
    }
  });

  it("status='incomplete' + Plus plan で audience → 403 PLAN_REQUIRED", async () => {
    mockSubscription.findUnique.mockResolvedValue({ status: "incomplete", plan: { name: "plus" } });
    const result = await requirePlanFeature({ oaId: "oa-1", featureKey: FEATURE.audience });
    expect(result.ok).toBe(false);
  });

  it("status='paused' + Plus plan でも workInfo (= Basic 機能) → allowed", async () => {
    // 非アクティブでも basic にフォールバックするので、Basic 範囲は使える
    mockSubscription.findUnique.mockResolvedValue({ status: "paused", plan: { name: "plus" } });
    const result = await requirePlanFeature({ oaId: "oa-1", featureKey: FEATURE.workInfo });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan).toBe("basic");
  });

  it("workId / oaId 両方未指定 → 403 (= 設計バグ扱い、安全側)", async () => {
    const result = await requirePlanFeature({ featureKey: FEATURE.location });
    expect(result.ok).toBe(false);
  });

  it("Subscription 未設定 → basic 扱い → Basic 機能なら allowed", async () => {
    mockSubscription.findUnique.mockResolvedValue(null);
    const allowed = await requirePlanFeature({ oaId: "oa-x", featureKey: FEATURE.workInfo });
    expect(allowed.ok).toBe(true);
  });

  it("Subscription 未設定 → basic 扱い → 上位機能は拒否", async () => {
    mockSubscription.findUnique.mockResolvedValue(null);
    const denied = await requirePlanFeature({ oaId: "oa-x", featureKey: FEATURE.audience });
    expect(denied.ok).toBe(false);
  });
});
