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
