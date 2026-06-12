// src/__tests__/usage-type.test.ts
// OA 利用区分（個人/法人）ヘルパーの検証。
import { describe, it, expect } from "vitest";
import {
  usageTypeShortLabel,
  USAGE_TYPE_SHORT_LABELS,
  USAGE_TYPES,
  usageTypeSchema,
} from "@/lib/usage-type";

describe("usageTypeShortLabel", () => {
  it("personal → 個人 / business → 法人", () => {
    expect(usageTypeShortLabel("personal")).toBe("個人");
    expect(usageTypeShortLabel("business")).toBe("法人");
  });

  it("未設定 / 不明値 / null は個人にフォールバック", () => {
    expect(usageTypeShortLabel(null)).toBe("個人");
    expect(usageTypeShortLabel(undefined)).toBe("個人");
    expect(usageTypeShortLabel("")).toBe("個人");
    expect(usageTypeShortLabel("xxx")).toBe("個人");
  });
});

describe("USAGE_TYPE_SHORT_LABELS / USAGE_TYPES", () => {
  it("値とラベルが一致", () => {
    expect(USAGE_TYPE_SHORT_LABELS.personal).toBe("個人");
    expect(USAGE_TYPE_SHORT_LABELS.business).toBe("法人");
    expect(USAGE_TYPES).toEqual(["personal", "business"]);
  });
});

describe("usageTypeSchema", () => {
  it("personal / business のみ許可", () => {
    expect(usageTypeSchema.safeParse("personal").success).toBe(true);
    expect(usageTypeSchema.safeParse("business").success).toBe(true);
    expect(usageTypeSchema.safeParse("owner").success).toBe(false);
    expect(usageTypeSchema.safeParse("").success).toBe(false);
  });
});
