// src/__tests__/plans.test.ts
//
// プランティア / 機能対応 / 判定 helper の unit test。
// DB に触れない純関数だけを検証する。

import { describe, it, expect } from "vitest";
import {
  PLAN_TIER,
  PLAN_LABELS,
  FEATURE,
  HUB_CARD_TO_FEATURE,
  PLAN_FEATURES,
  PLAN_DESCRIPTIONS,
  PLAN_TIER_ORDER,
  mapPlanNameToTier,
  getRequiredPlanForFeature,
  isPlanAllowed,
  getPlanAccessState,
  getAccessState,
} from "@/lib/constants/plans";

// ──────────────────────────────────────────────────────────
// プラン定義
// ──────────────────────────────────────────────────────────

describe("PLAN_TIER / PLAN_LABELS / PLAN_TIER_ORDER", () => {
  it("PLAN_TIER は 4 段階", () => {
    expect(Object.keys(PLAN_TIER).sort()).toEqual(["basic", "plus", "pro", "standard"]);
  });

  it("PLAN_LABELS は表示用名 (Basic/Standard/Plus/Pro Max) を返す", () => {
    expect(PLAN_LABELS.basic).toBe("Basic");
    expect(PLAN_LABELS.standard).toBe("Standard");
    expect(PLAN_LABELS.plus).toBe("Plus");
    expect(PLAN_LABELS.pro).toBe("Pro Max");
  });

  it("PLAN_TIER_ORDER は basic → standard → plus → pro の順", () => {
    expect(PLAN_TIER_ORDER).toEqual(["basic", "standard", "plus", "pro"]);
  });
});

// ──────────────────────────────────────────────────────────
// HUB_CARD_TO_FEATURE
// ──────────────────────────────────────────────────────────

describe("HUB_CARD_TO_FEATURE — card.key → feature key マッピング", () => {
  it("全 8 カードがマップされている", () => {
    expect(HUB_CARD_TO_FEATURE.edit).toBe(FEATURE.workInfo);
    expect(HUB_CARD_TO_FEATURE.characters).toBe(FEATURE.characters);
    expect(HUB_CARD_TO_FEATURE.messages).toBe(FEATURE.messages);
    expect(HUB_CARD_TO_FEATURE.scenario).toBe(FEATURE.scenarioFlow);
    expect(HUB_CARD_TO_FEATURE.audience).toBe(FEATURE.audience);
    expect(HUB_CARD_TO_FEATURE.liff).toBe(FEATURE.liffDisplay);
    expect(HUB_CARD_TO_FEATURE.destinations).toBe(FEATURE.destinations);
    expect(HUB_CARD_TO_FEATURE.locations).toBe(FEATURE.location);
  });
});

// ──────────────────────────────────────────────────────────
// PLAN_FEATURES
// ──────────────────────────────────────────────────────────

describe("PLAN_FEATURES — プラン階段", () => {
  it("Basic は 4 機能のみ", () => {
    expect(PLAN_FEATURES.basic).toEqual([
      "work.info", "characters", "messages", "scenarioFlow",
    ]);
  });

  it("Standard は Basic + audience", () => {
    expect(PLAN_FEATURES.standard).toContain("audience");
    expect(PLAN_FEATURES.standard).not.toContain("liffDisplay");
  });

  it("Plus は Standard + liffDisplay + destinations", () => {
    expect(PLAN_FEATURES.plus).toContain("liffDisplay");
    expect(PLAN_FEATURES.plus).toContain("destinations");
    expect(PLAN_FEATURES.plus).not.toContain("location");
  });

  it("Pro は全 8 機能", () => {
    expect(PLAN_FEATURES.pro.length).toBe(8);
    expect(PLAN_FEATURES.pro).toContain("location");
  });

  it("上位プランは下位プランの機能を全て包含する", () => {
    for (let i = 1; i < PLAN_TIER_ORDER.length; i++) {
      const lower = PLAN_FEATURES[PLAN_TIER_ORDER[i - 1]];
      const upper = PLAN_FEATURES[PLAN_TIER_ORDER[i]];
      for (const feat of lower) {
        expect(upper).toContain(feat);
      }
    }
  });
});

// ──────────────────────────────────────────────────────────
// PLAN_DESCRIPTIONS
// ──────────────────────────────────────────────────────────

describe("PLAN_DESCRIPTIONS — 管理メニュー下部の説明文", () => {
  it("4 プラン全てに説明文がある", () => {
    expect(PLAN_DESCRIPTIONS.basic).toContain("Basicプラン");
    expect(PLAN_DESCRIPTIONS.standard).toContain("Standardプラン");
    expect(PLAN_DESCRIPTIONS.plus).toContain("Plusプラン");
    expect(PLAN_DESCRIPTIONS.pro).toContain("Pro Maxプラン");
  });

  it("Pro の説明文は「すべて」を含む", () => {
    expect(PLAN_DESCRIPTIONS.pro).toMatch(/すべて/);
  });
});

// ──────────────────────────────────────────────────────────
// mapPlanNameToTier
// ──────────────────────────────────────────────────────────

describe("mapPlanNameToTier — 既存 plan.name → tier", () => {
  it("既存 MVP の tester → basic", () => {
    expect(mapPlanNameToTier("tester")).toBe("basic");
  });

  it("既存 MVP の editor → pro", () => {
    expect(mapPlanNameToTier("editor")).toBe("pro");
  });

  it("enterprise → pro", () => {
    expect(mapPlanNameToTier("enterprise")).toBe("pro");
  });

  it("4 ティア名 (basic/standard/plus/pro) はそのまま返す", () => {
    expect(mapPlanNameToTier("basic")).toBe("basic");
    expect(mapPlanNameToTier("standard")).toBe("standard");
    expect(mapPlanNameToTier("plus")).toBe("plus");
    expect(mapPlanNameToTier("pro")).toBe("pro");
  });

  it("null / undefined / 不明な値は basic にフォールバック", () => {
    expect(mapPlanNameToTier(null)).toBe("basic");
    expect(mapPlanNameToTier(undefined)).toBe("basic");
    expect(mapPlanNameToTier("")).toBe("basic");
    expect(mapPlanNameToTier("unknown_plan_xyz")).toBe("basic");
  });
});

// ──────────────────────────────────────────────────────────
// getRequiredPlanForFeature
// ──────────────────────────────────────────────────────────

describe("getRequiredPlanForFeature — feature に必要な最低プラン", () => {
  it("Basic 機能は basic を返す", () => {
    expect(getRequiredPlanForFeature("work.info")).toBe("basic");
    expect(getRequiredPlanForFeature("characters")).toBe("basic");
    expect(getRequiredPlanForFeature("messages")).toBe("basic");
    expect(getRequiredPlanForFeature("scenarioFlow")).toBe("basic");
  });

  it("audience → standard", () => {
    expect(getRequiredPlanForFeature("audience")).toBe("standard");
  });

  it("liffDisplay / destinations → plus", () => {
    expect(getRequiredPlanForFeature("liffDisplay")).toBe("plus");
    expect(getRequiredPlanForFeature("destinations")).toBe("plus");
  });

  it("location → pro", () => {
    expect(getRequiredPlanForFeature("location")).toBe("pro");
  });
});

// ──────────────────────────────────────────────────────────
// isPlanAllowed
// ──────────────────────────────────────────────────────────

describe("isPlanAllowed — 現プランで feature が使えるか", () => {
  it("basic では audience を使えない", () => {
    expect(isPlanAllowed("basic", "audience")).toBe(false);
  });

  it("standard では audience は使える / liffDisplay は使えない", () => {
    expect(isPlanAllowed("standard", "audience")).toBe(true);
    expect(isPlanAllowed("standard", "liffDisplay")).toBe(false);
  });

  it("plus では liffDisplay / destinations は使える / location は使えない", () => {
    expect(isPlanAllowed("plus", "liffDisplay")).toBe(true);
    expect(isPlanAllowed("plus", "destinations")).toBe(true);
    expect(isPlanAllowed("plus", "location")).toBe(false);
  });

  it("pro ですべて使える", () => {
    expect(isPlanAllowed("pro", "work.info")).toBe(true);
    expect(isPlanAllowed("pro", "audience")).toBe(true);
    expect(isPlanAllowed("pro", "liffDisplay")).toBe(true);
    expect(isPlanAllowed("pro", "location")).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// getPlanAccessState
// ──────────────────────────────────────────────────────────

describe("getPlanAccessState — UI のグレーアウト判定で使う", () => {
  it("Basic で audience は plan_required + requiredPlan=standard + ラベル='Standard'", () => {
    const s = getPlanAccessState({ plan: "basic", featureKey: "audience" });
    expect(s.allowed).toBe(false);
    if (!s.allowed) {
      expect(s.reason).toBe("plan_required");
      expect(s.requiredPlan).toBe("standard");
      expect(s.requiredPlanLabel).toBe("Standard");
      expect(s.message).toBe("この機能はStandardプラン以上で利用できます");
    }
  });

  it("Standard で audience は allowed", () => {
    const s = getPlanAccessState({ plan: "standard", featureKey: "audience" });
    expect(s.allowed).toBe(true);
    expect(s.reason).toBe("allowed");
    expect(s.message).toBe("利用できます");
  });

  it("Standard で liffDisplay は plan_required + Plus 必要", () => {
    const s = getPlanAccessState({ plan: "standard", featureKey: "liffDisplay" });
    expect(s.allowed).toBe(false);
    if (!s.allowed) {
      expect(s.requiredPlanLabel).toBe("Plus");
      expect(s.message).toContain("Plus");
    }
  });

  it("Plus で liffDisplay / destinations は allowed", () => {
    expect(getPlanAccessState({ plan: "plus", featureKey: "liffDisplay" }).allowed).toBe(true);
    expect(getPlanAccessState({ plan: "plus", featureKey: "destinations" }).allowed).toBe(true);
  });

  it("Plus で location は plan_required + Pro Max 必要", () => {
    const s = getPlanAccessState({ plan: "plus", featureKey: "location" });
    expect(s.allowed).toBe(false);
    if (!s.allowed) {
      expect(s.requiredPlanLabel).toBe("Pro Max");
      expect(s.message).toContain("Pro Max");
    }
  });

  it("Pro Max で location は allowed", () => {
    expect(getPlanAccessState({ plan: "pro", featureKey: "location" }).allowed).toBe(true);
  });

  it("requiredPlanLabel は表示用 (Basic/Standard/Plus/Pro Max)", () => {
    expect(getPlanAccessState({ plan: "basic", featureKey: "audience" })).toMatchObject({
      requiredPlanLabel: "Standard",
    });
    expect(getPlanAccessState({ plan: "basic", featureKey: "liffDisplay" })).toMatchObject({
      requiredPlanLabel: "Plus",
    });
    expect(getPlanAccessState({ plan: "basic", featureKey: "location" })).toMatchObject({
      requiredPlanLabel: "Pro Max",
    });
  });
});

// ──────────────────────────────────────────────────────────
// getAccessState (= 将来の role 拡張入口)
// ──────────────────────────────────────────────────────────

describe("getAccessState — plan + role 統合判定 (= 現時点では plan のみ評価)", () => {
  it("plan が許可していれば role に関係なく allowed", () => {
    const s = getAccessState({
      plan: "pro",
      role: "client_operator",
      featureKey: "audience",
      actionKey: "edit",
    });
    // 現時点では role は評価しないため、plan が許可していれば allowed
    expect(s.allowed).toBe(true);
  });

  it("plan が不足していれば plan_required を返す", () => {
    const s = getAccessState({
      plan: "basic",
      role: "owner",
      featureKey: "liffDisplay",
    });
    expect(s.allowed).toBe(false);
    if (!s.allowed && s.reason === "plan_required") {
      expect(s.requiredPlanLabel).toBe("Plus");
    }
  });

  it("role / actionKey 引数が無くても (= 現状の UI 利用) 動く", () => {
    const s = getAccessState({ plan: "basic", featureKey: "audience" });
    expect(s.allowed).toBe(false);
  });
});
