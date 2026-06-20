/**
 * src/__tests__/liff-image-aspect.test.ts
 * PR-BLK4b: 画像ブロックの aspect_ratio 解決（純関数）+ additive validation。
 */
import { describe, it, expect } from "vitest";
import { resolveImageAspectRatio, ASPECT_RATIO_CSS } from "@/components/liff/image-aspect";
import { validateBlockSettings } from "@/lib/validations";

describe("resolveImageAspectRatio", () => {
  it("未設定は original 扱い", () => {
    expect(resolveImageAspectRatio(undefined)).toBe("original");
  });
  it("不明値は original fallback", () => {
    expect(resolveImageAspectRatio("bogus")).toBe("original");
    expect(resolveImageAspectRatio("3:2")).toBe("original");
    expect(resolveImageAspectRatio("")).toBe("original");
  });
  it("1:1 / 4:3 / 16:9 はそのまま", () => {
    expect(resolveImageAspectRatio("1:1")).toBe("1:1");
    expect(resolveImageAspectRatio("4:3")).toBe("4:3");
    expect(resolveImageAspectRatio("16:9")).toBe("16:9");
  });
  it("CSS マップは固定比率3種のみ", () => {
    expect(ASPECT_RATIO_CSS["1:1"]).toBe("1 / 1");
    expect(ASPECT_RATIO_CSS["4:3"]).toBe("4 / 3");
    expect(ASPECT_RATIO_CSS["16:9"]).toBe("16 / 9");
    expect(new Set(Object.keys(ASPECT_RATIO_CSS))).toEqual(new Set(["1:1", "4:3", "16:9"]));
  });
});

describe("image settings validation（aspect_ratio は additive・任意）", () => {
  it("aspect_ratio 無しの既存データが通る（後方互換）", () => {
    expect(validateBlockSettings("image", { image_url: "https://x/a.png", size: "wide" }).success).toBe(true);
    expect(validateBlockSettings("image", {}).success).toBe(true);
  });
  it("各 aspect_ratio 値を受理", () => {
    for (const r of ["original", "1:1", "4:3", "16:9"]) {
      expect(validateBlockSettings("image", { image_url: "https://x/a.png", aspect_ratio: r }).success).toBe(true);
    }
  });
  it("不正な aspect_ratio は reject（enum）", () => {
    expect(validateBlockSettings("image", { image_url: "https://x/a.png", aspect_ratio: "3:2" }).success).toBe(false);
  });
  it("既存 size はそのまま有効・aspect_ratio と併用可", () => {
    expect(validateBlockSettings("image", { image_url: "https://x/a.png", size: "full", aspect_ratio: "16:9" }).success).toBe(true);
  });
});
