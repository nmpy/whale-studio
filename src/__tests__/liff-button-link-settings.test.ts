/**
 * src/__tests__/liff-button-link-settings.test.ts
 *
 * ボタンリンクブロックの設定バリデーションを検証する。
 * - url が空文字（追加直後の既定）でも作成/保存が通る（以前は z.string().url() で 400 になっていた）
 * - 非空のときは URL 形式を検証する
 * - link_type / liff_page_id / location_id を許容（external 後方互換）
 */
import { describe, it, expect } from "vitest";
import { validateBlockSettings } from "@/lib/validations";
// 純 .ts の variant 源から import（barrel 経由だと JSX component を引き込み vitest が transform 失敗するため）。
import { normalizeLiffButtonVariant, LIFF_BUTTON_VARIANTS } from "@/components/liff/primitives/button-variants";

describe("validateBlockSettings(button_link)", () => {
  it("url 空文字（既定）でも success（追加直後に落ちない）", () => {
    expect(validateBlockSettings("button_link", { label: "", url: "", open_external: true, variant: "default", link_type: "external" }).success).toBe(true);
  });

  it("外部URL: 妥当な URL は success", () => {
    expect(validateBlockSettings("button_link", { label: "詳しく見る", link_type: "external", url: "https://example.com" }).success).toBe(true);
  });

  it("非空で URL 形式が不正なら失敗", () => {
    expect(validateBlockSettings("button_link", { label: "x", url: "not-a-url" }).success).toBe(false);
  });

  it("link_type 未指定（既存データ）でも success（external 互換）", () => {
    expect(validateBlockSettings("button_link", { label: "旧ボタン", url: "https://old.example" }).success).toBe(true);
  });

  it("liff_page / location 参照（解決済み url 同梱）も success", () => {
    expect(validateBlockSettings("button_link", { label: "次へ", link_type: "liff_page", liff_page_id: "pid", url: "https://x/liff/w/wp/p/pp" }).success).toBe(true);
    expect(validateBlockSettings("button_link", { label: "チェックイン", link_type: "location", location_id: "lid", url: "https://x/liff/c/wp/loc" }).success).toBe(true);
  });
});

// PR3: ブロック用ボタンデザイン（button_variant）。3ブロックすべてで validation。
describe("validateBlockSettings — button_variant", () => {
  const blocks = ["start_button", "resume_button", "button_link"] as const;

  for (const b of blocks) {
    it(`${b}: 既知 variant は success`, () => {
      for (const v of LIFF_BUTTON_VARIANTS) {
        expect(validateBlockSettings(b, { button_variant: v }).success).toBe(true);
      }
    });
    it(`${b}: 空文字（未設定）は success`, () => {
      expect(validateBlockSettings(b, { button_variant: "" }).success).toBe(true);
    });
    it(`${b}: button_variant 省略でも success（後方互換）`, () => {
      expect(validateBlockSettings(b, {}).success).toBe(true);
    });
    it(`${b}: 不正な variant は失敗`, () => {
      expect(validateBlockSettings(b, { button_variant: "rainbow" }).success).toBe(false);
    });
  }
});

// renderer が使う既定フォールバック（StartButton=primary / Resume=outline / ButtonLink=outline）。
describe("normalizeLiffButtonVariant — ブロック既定フォールバック", () => {
  it("未設定は各ブロックの既定を維持する", () => {
    expect(normalizeLiffButtonVariant(undefined, "primary")).toBe("primary"); // StartButton
    expect(normalizeLiffButtonVariant(undefined, "outline")).toBe("outline"); // Resume / ButtonLink
  });
  it("空文字も既定にフォールバック", () => {
    expect(normalizeLiffButtonVariant("", "primary")).toBe("primary");
  });
  it("設定された既知 variant は反映される", () => {
    expect(normalizeLiffButtonVariant("dark", "primary")).toBe("dark");
    expect(normalizeLiffButtonVariant("ghost", "outline")).toBe("ghost");
  });
  it("不正値は安全に既定へフォールバック", () => {
    expect(normalizeLiffButtonVariant("rainbow", "primary")).toBe("primary");
    expect(normalizeLiffButtonVariant(123, "outline")).toBe("outline");
  });
  it("LIFF_BUTTON_VARIANTS が真実源（5 variant）", () => {
    expect([...LIFF_BUTTON_VARIANTS]).toEqual(["primary", "outline", "ghost", "dark", "danger"]);
  });
});
