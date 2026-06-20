/**
 * src/__tests__/liff-warning-icon.test.ts
 * PR-BLK4a: バナー左アイコンの解決（純関数）+ icon の additive validation。
 */
import { describe, it, expect } from "vitest";
import { resolveWarningIcon } from "@/components/liff/warning-icon";
import { validateBlockSettings } from "@/lib/validations";

describe("resolveWarningIcon", () => {
  it("icon 未設定は auto 扱い → tone から導出", () => {
    expect(resolveWarningIcon("spoiler", undefined)).toBe("warning");
    expect(resolveWarningIcon("info", undefined)).toBe("info");
    expect(resolveWarningIcon("danger", undefined)).toBe("alert");
  });
  it("icon='auto' は tone から導出", () => {
    expect(resolveWarningIcon("spoiler", "auto")).toBe("warning");
    expect(resolveWarningIcon("info", "auto")).toBe("info");
    expect(resolveWarningIcon("danger", "auto")).toBe("alert");
  });
  it("icon='none' は非表示", () => {
    expect(resolveWarningIcon("info", "none")).toBe("none");
    expect(resolveWarningIcon("danger", "none")).toBe("none");
  });
  it("明示指定（warning/info/alert）はそのまま", () => {
    expect(resolveWarningIcon("info", "warning")).toBe("warning");
    expect(resolveWarningIcon("danger", "info")).toBe("info");
    expect(resolveWarningIcon("spoiler", "alert")).toBe("alert");
  });
  it("unknown icon / unknown tone でもクラッシュせず安全 fallback", () => {
    expect(resolveWarningIcon("spoiler", "bogus")).toBe("warning"); // unknown icon → auto → tone
    expect(resolveWarningIcon("totally_unknown", "auto")).toBe("warning"); // unknown tone → warning
    expect(resolveWarningIcon(undefined, undefined)).toBe("warning");
  });
});

describe("warning settings validation（icon は additive・任意）", () => {
  it("icon 無しの既存データが通る（後方互換）", () => {
    expect(validateBlockSettings("warning", { body: "注意", tone: "spoiler" }).success).toBe(true);
    expect(validateBlockSettings("warning", {}).success).toBe(true);
  });
  it("icon の各値を受理", () => {
    for (const ic of ["auto", "none", "warning", "info", "alert"]) {
      expect(validateBlockSettings("warning", { body: "x", icon: ic }).success).toBe(true);
    }
  });
  it("不正な icon 値は reject（enum）", () => {
    expect(validateBlockSettings("warning", { body: "x", icon: "bogus" }).success).toBe(false);
  });
});
