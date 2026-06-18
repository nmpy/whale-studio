/**
 * src/__tests__/liff-home-layout.test.ts
 *
 * PR2 ホーム刷新の純関数ロジック回帰:
 *  - parseLiffHomeSettings: home_menu_layout の既定("card")/正規化
 *  - resolveMenuIconImageUrl: 空/未設定 → null、trim
 *  - buildMenuCards: iconImageUrl の伝播（未設定は null = 従来表示維持）
 */
import { describe, it, expect } from "vitest";
import {
  parseLiffHomeSettings,
  resolveMenuIconImageUrl,
  buildMenuCards,
  type MenuCardSource,
} from "@/components/liff/liff-style-helpers";

describe("parseLiffHomeSettings — home_menu_layout", () => {
  it("未設定は 'card'（既存作品の従来表示を維持）", () => {
    expect(parseLiffHomeSettings({}).home_menu_layout).toBe("card");
    expect(parseLiffHomeSettings(null).home_menu_layout).toBe("card");
  });
  it("'list' はそのまま", () => {
    expect(parseLiffHomeSettings({ home_menu_layout: "list" }).home_menu_layout).toBe("list");
  });
  it("未知値は 'card' にフォールバック", () => {
    expect(parseLiffHomeSettings({ home_menu_layout: "weird" }).home_menu_layout).toBe("card");
    expect(parseLiffHomeSettings({ home_menu_layout: 123 }).home_menu_layout).toBe("card");
  });
});

describe("resolveMenuIconImageUrl", () => {
  it("未設定/空文字/空白のみ → null", () => {
    expect(resolveMenuIconImageUrl(null)).toBeNull();
    expect(resolveMenuIconImageUrl(undefined)).toBeNull();
    expect(resolveMenuIconImageUrl({})).toBeNull();
    expect(resolveMenuIconImageUrl({ menu_icon_image_url: "" })).toBeNull();
    expect(resolveMenuIconImageUrl({ menu_icon_image_url: "   " })).toBeNull();
  });
  it("設定時は trim した URL を返す", () => {
    expect(resolveMenuIconImageUrl({ menu_icon_image_url: "  https://x.test/i.png  " })).toBe("https://x.test/i.png");
  });
});

describe("buildMenuCards — iconImageUrl 伝播", () => {
  const base: MenuCardSource = {
    id: "p1", public_id: "pub1", page_type: "default", title: "ページ1", is_enabled: true,
  };
  it("menu_icon_image_url 設定時は card.iconImageUrl にセットされる", () => {
    const cards = buildMenuCards([{ ...base, settings_json: { menu_icon_image_url: "https://x.test/a.png" } }]);
    expect(cards).toHaveLength(1);
    expect(cards[0].iconImageUrl).toBe("https://x.test/a.png");
  });
  it("未設定時は iconImageUrl=null（従来表示）", () => {
    const cards = buildMenuCards([{ ...base, settings_json: {} }]);
    expect(cards[0].iconImageUrl).toBeNull();
  });
});
