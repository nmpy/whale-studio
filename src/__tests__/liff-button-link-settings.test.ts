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
