// src/__tests__/subscription-grant.test.ts
// β版 / 7日トライアルの判定純ロジック。
import { describe, it, expect } from "vitest";
import {
  isBeta,
  isTrialActive,
  isTrialExpired,
  effectiveTierFromSub,
  grantDisplayKind,
  formatTrialEndDate,
  manualOverrideTier,
  isManualOverrideActive,
} from "@/lib/subscription-grant";

const NOW = new Date("2026-06-12T00:00:00.000Z").getTime();
const FUTURE = "2026-06-19T00:00:00.000Z"; // +7d
const PAST   = "2026-06-05T00:00:00.000Z"; // 過去

describe("isBeta", () => {
  it("grantType=beta のみ true", () => {
    expect(isBeta("beta")).toBe(true);
    expect(isBeta("trial")).toBe(false);
    expect(isBeta(null)).toBe(false);
  });
});

describe("isTrialActive / isTrialExpired", () => {
  it("trial + 未来 trialEndsAt → active / not expired", () => {
    expect(isTrialActive("trial", FUTURE, NOW)).toBe(true);
    expect(isTrialExpired("trial", FUTURE, NOW)).toBe(false);
  });
  it("trial + 過去 trialEndsAt → expired / not active", () => {
    expect(isTrialActive("trial", PAST, NOW)).toBe(false);
    expect(isTrialExpired("trial", PAST, NOW)).toBe(true);
  });
  it("trial + trialEndsAt なし → active 扱い（防御的）", () => {
    expect(isTrialActive("trial", null, NOW)).toBe(true);
    expect(isTrialExpired("trial", null, NOW)).toBe(false);
  });
  it("beta / null は trial 判定に乗らない", () => {
    expect(isTrialActive("beta", PAST, NOW)).toBe(false);
    expect(isTrialExpired("beta", PAST, NOW)).toBe(false);
    expect(isTrialActive(null, FUTURE, NOW)).toBe(false);
  });
});

describe("effectiveTierFromSub", () => {
  it("β版 (active+beta+plan=pro) → pro", () => {
    expect(effectiveTierFromSub({ status: "active", grantType: "beta", trialEndsAt: null, planName: "pro" }, NOW)).toBe("pro");
  });
  it("トライアル内 (trialing+trial+pro+未来) → pro", () => {
    expect(effectiveTierFromSub({ status: "trialing", grantType: "trial", trialEndsAt: FUTURE, planName: "pro" }, NOW)).toBe("pro");
  });
  it("トライアル失効 (trialing+trial+pro+過去) → basic", () => {
    expect(effectiveTierFromSub({ status: "trialing", grantType: "trial", trialEndsAt: PAST, planName: "pro" }, NOW)).toBe("basic");
  });
  it("通常 active + plan=standard → standard", () => {
    expect(effectiveTierFromSub({ status: "active", grantType: null, trialEndsAt: null, planName: "standard" }, NOW)).toBe("standard");
  });
  it("canceled (full access 外) → basic", () => {
    expect(effectiveTierFromSub({ status: "canceled", grantType: null, trialEndsAt: null, planName: "pro" }, NOW)).toBe("basic");
  });
  it("sub なし → basic", () => {
    expect(effectiveTierFromSub(null, NOW)).toBe("basic");
  });
});

describe("grantDisplayKind", () => {
  it("beta / trial_active / trial_expired / normal を判定", () => {
    expect(grantDisplayKind({ status: "active",   grantType: "beta",  trialEndsAt: null,   planName: "pro" }, NOW)).toBe("beta");
    expect(grantDisplayKind({ status: "trialing", grantType: "trial", trialEndsAt: FUTURE, planName: "pro" }, NOW)).toBe("trial_active");
    expect(grantDisplayKind({ status: "trialing", grantType: "trial", trialEndsAt: PAST,   planName: "pro" }, NOW)).toBe("trial_expired");
    expect(grantDisplayKind({ status: "active",   grantType: null,    trialEndsAt: null,   planName: "standard" }, NOW)).toBe("normal");
    expect(grantDisplayKind(null, NOW)).toBe("normal");
  });
});

describe("formatTrialEndDate", () => {
  it("JST の YYYY/MM/DD を返す / null は null", () => {
    expect(formatTrialEndDate(FUTURE)).toBe("2026/06/19");
    expect(formatTrialEndDate(null)).toBeNull();
    expect(formatTrialEndDate(undefined)).toBeNull();
  });
});

// ── 手動上書き（manual override・PR3）─────────────────────────────
describe("manualOverrideTier / isManualOverrideActive", () => {
  it("有効な手動上書き（期限内・未無効化）→ その tier", () => {
    const sub = { status: "active", manualPlanTier: "pro" };
    expect(manualOverrideTier(sub, NOW)).toBe("pro");
    expect(isManualOverrideActive(sub, NOW)).toBe(true);
  });
  it("manualDisabledAt があれば無効（null 返す）", () => {
    expect(manualOverrideTier({ status: "active", manualPlanTier: "pro", manualDisabledAt: PAST }, NOW)).toBeNull();
  });
  it("manual_ends_at === now は無効（now < ends 条件）", () => {
    const ends = new Date(NOW).toISOString();
    expect(manualOverrideTier({ status: "active", manualPlanTier: "pro", manualEndsAt: ends }, NOW)).toBeNull();
  });
  it("manual_starts_at === now は有効（now >= starts 条件）", () => {
    const starts = new Date(NOW).toISOString();
    expect(manualOverrideTier({ status: "active", manualPlanTier: "pro", manualStartsAt: starts }, NOW)).toBe("pro");
  });
  it("開始前（manual_starts_at 未来）は無効", () => {
    expect(manualOverrideTier({ status: "active", manualPlanTier: "pro", manualStartsAt: FUTURE }, NOW)).toBeNull();
  });
  it("不正な manualPlanTier は無効扱い（null）", () => {
    expect(manualOverrideTier({ status: "active", manualPlanTier: "ultra" }, NOW)).toBeNull();
    expect(manualOverrideTier({ status: "active", manualPlanTier: "" }, NOW)).toBeNull();
  });
  it("delegated も有効な PlanTier", () => {
    expect(manualOverrideTier({ status: "active", manualPlanTier: "delegated" }, NOW)).toBe("delegated");
  });
});

describe("effectiveTierFromSub: 解決順 manual > beta/trial > Stripe > basic", () => {
  it("手動上書きは Stripe active より優先", () => {
    expect(effectiveTierFromSub({ status: "active", planName: "standard", manualPlanTier: "pro" }, NOW)).toBe("pro");
  });
  it("手動無効化 → Stripe active があれば Stripe tier に戻る", () => {
    expect(effectiveTierFromSub({ status: "active", planName: "standard", manualPlanTier: "pro", manualDisabledAt: PAST }, NOW)).toBe("standard");
  });
  it("手動期限切れ → Stripe active があれば Stripe tier に戻る", () => {
    expect(effectiveTierFromSub({ status: "active", planName: "standard", manualPlanTier: "pro", manualEndsAt: PAST }, NOW)).toBe("standard");
  });
  it("不正な manual + Stripe active → Stripe tier に戻る（basic 固定にしない）", () => {
    expect(effectiveTierFromSub({ status: "active", planName: "standard", manualPlanTier: "ultra" }, NOW)).toBe("standard");
  });
  it("不正な manual + Stripe なし + beta → beta(pro) に戻る", () => {
    expect(effectiveTierFromSub({ status: "active", planName: "pro", grantType: "beta", manualPlanTier: "ultra" }, NOW)).toBe("pro");
  });
  it("不正な manual + 他に有効なものなし（canceled）→ basic", () => {
    expect(effectiveTierFromSub({ status: "canceled", planName: "pro", manualPlanTier: "ultra" }, NOW)).toBe("basic");
  });
  it("manual_* 全 null は従来挙動と完全一致（beta=pro / trial期限内=pro / trial失効=basic / canceled=basic）", () => {
    expect(effectiveTierFromSub({ status: "active", planName: "pro", grantType: "beta" }, NOW)).toBe("pro");
    expect(effectiveTierFromSub({ status: "trialing", planName: "pro", grantType: "trial", trialEndsAt: FUTURE }, NOW)).toBe("pro");
    expect(effectiveTierFromSub({ status: "trialing", planName: "pro", grantType: "trial", trialEndsAt: PAST }, NOW)).toBe("basic");
    expect(effectiveTierFromSub({ status: "canceled", planName: "pro" }, NOW)).toBe("basic");
    expect(effectiveTierFromSub({ status: "active", planName: "standard" }, NOW)).toBe("standard");
  });
  it("手動無効化 + Stripe なし + beta なし → basic", () => {
    expect(effectiveTierFromSub({ status: "canceled", planName: "pro", manualPlanTier: "pro", manualDisabledAt: PAST }, NOW)).toBe("basic");
  });
});
