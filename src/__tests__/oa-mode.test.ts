/**
 * src/__tests__/oa-mode.test.ts
 *
 * OA 運用モード（Oa.mode）の純ロジック + updateOaSchema の mode 受理を検証する。
 */
import { describe, it, expect } from "vitest";
import {
  OA_MODES, DEFAULT_OA_MODE, normalizeOaMode, isOaMode,
  OA_MODE_LABELS, OA_MODE_DESCRIPTIONS,
} from "@/lib/oa-mode";
import { updateOaSchema } from "@/lib/validations";

describe("oa-mode 定数", () => {
  it("モードは messaging / content / live の3種", () => {
    expect(OA_MODES).toEqual(["messaging", "content", "live"]);
  });
  it("既定は content（非破壊の安全側）", () => {
    expect(DEFAULT_OA_MODE).toBe("content");
  });
  it("全モードに label / description がある", () => {
    for (const m of OA_MODES) {
      expect(OA_MODE_LABELS[m]).toBeTruthy();
      expect(OA_MODE_DESCRIPTIONS[m]).toBeTruthy();
    }
  });
});

describe("normalizeOaMode", () => {
  it("有効値はそのまま", () => {
    expect(normalizeOaMode("messaging")).toBe("messaging");
    expect(normalizeOaMode("content")).toBe("content");
    expect(normalizeOaMode("live")).toBe("live");
  });
  it("null / undefined / 不正値は content にフォールバック", () => {
    expect(normalizeOaMode(null)).toBe("content");
    expect(normalizeOaMode(undefined)).toBe("content");
    expect(normalizeOaMode("")).toBe("content");
    expect(normalizeOaMode("bogus")).toBe("content");
  });
});

describe("isOaMode", () => {
  it("OaMode のみ true", () => {
    expect(isOaMode("live")).toBe(true);
    expect(isOaMode("messaging")).toBe(true);
    expect(isOaMode("bogus")).toBe(false);
    expect(isOaMode(null)).toBe(false);
    expect(isOaMode(123)).toBe(false);
  });
});

describe("updateOaSchema: mode 受理", () => {
  it("有効な mode を受理する", () => {
    expect(updateOaSchema.safeParse({ mode: "live" }).success).toBe(true);
    expect(updateOaSchema.safeParse({ mode: "messaging" }).success).toBe(true);
    expect(updateOaSchema.safeParse({ mode: "content" }).success).toBe(true);
  });
  it("mode 省略は OK（部分更新・変更なし）", () => {
    expect(updateOaSchema.safeParse({ title: "x" }).success).toBe(true);
  });
  it("不正な mode は reject", () => {
    expect(updateOaSchema.safeParse({ mode: "bogus" }).success).toBe(false);
  });
});
