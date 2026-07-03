// src/__tests__/work-sidebar-nav.test.ts
import { describe, it, expect } from "vitest";
import { buildWorkSidebarSections, isSidebarItemActive } from "@/app/oas/[id]/works/[workId]/_work-sidebar-nav";

const OA = "oa1", WORK = "wk1";
const base = `/oas/${OA}/works/${WORK}`;
const build = (isTester = false) => buildWorkSidebarSections({ oaId: OA, workId: WORK, isTester });
const sec = (label: string) => build().find((s) => s.heading === label);
const allItems = (isTester = false) => build(isTester).flatMap((s) => s.items);
const item = (label: string, isTester = false) => allItems(isTester).find((i) => i.label === label);

describe("buildWorkSidebarSections — セクション構成", () => {
  it("見出し順は 主要機能 → 設定 → その他（設定は その他 の上）", () => {
    expect(build().map((s) => s.heading)).toEqual([undefined, "主要機能", "設定", "その他"]);
  });

  it("先頭セクションは 作品トップ のみ（作品情報 は無い）", () => {
    expect(build()[0].items.map((i) => i.label)).toEqual(["作品トップ"]);
    expect(allItems().some((i) => i.label === "作品情報")).toBe(false);
  });

  it("設定セクションに 作品設定 / アカウント設定（非tester）", () => {
    expect(sec("設定")!.items.map((i) => i.label)).toEqual(["作品設定", "アカウント設定"]);
  });

  it("tester はアカウント設定を非表示（作品設定のみ）", () => {
    const s = buildWorkSidebarSections({ oaId: OA, workId: WORK, isTester: true }).find((x) => x.heading === "設定")!;
    expect(s.items.map((i) => i.label)).toEqual(["作品設定"]);
  });

  it("その他セクションに X投稿 / 利用プラン", () => {
    expect(sec("その他")!.items.map((i) => i.label)).toEqual(["X投稿", "利用プラン"]);
  });

  it("主要機能は従来どおり6項目", () => {
    expect(sec("主要機能")!.items.map((i) => i.label))
      .toEqual(["フェーズ", "キャラクター", "メッセージ", "LIFF", "オーディエンス", "ロケーション"]);
  });
});

describe("遷移先 URL は既存を流用", () => {
  it("作品設定 = 旧作品情報の /edit（不変）", () => {
    expect(item("作品設定")!.href).toBe(`${base}/edit`);
  });
  it("アカウント設定 = OA 設定 /oas/[id]/settings", () => {
    expect(item("アカウント設定")!.href).toBe(`/oas/${OA}/settings`);
  });
  it("利用プラン = /pricing（buildPricingUrl・oa_id 付き）", () => {
    const href = item("利用プラン")!.href;
    expect(href.startsWith("/pricing")).toBe(true);
    expect(href).toContain(`oa_id=${OA}`);
  });
  it("X投稿 = /x-posts", () => {
    expect(item("X投稿")!.href).toBe(`${base}/x-posts`);
  });
});

describe("isSidebarItemActive — active 判定", () => {
  it("作品トップ: ベース完全一致のときのみ active", () => {
    const top = item("作品トップ")!;
    expect(isSidebarItemActive(top, base, base)).toBe(true);
    expect(isSidebarItemActive(top, `${base}/edit`, base)).toBe(false);
  });
  it("作品設定: /edit ページで active", () => {
    expect(isSidebarItemActive(item("作品設定")!, `${base}/edit`, base)).toBe(true);
    expect(isSidebarItemActive(item("作品設定")!, base, base)).toBe(false);
  });
  it("X投稿: /x-posts 配下で active", () => {
    expect(isSidebarItemActive(item("X投稿")!, `${base}/x-posts/new`, base)).toBe(true);
  });
  it("external（アカウント設定 / 利用プラン / ロケーション）は常に非active", () => {
    expect(isSidebarItemActive(item("アカウント設定")!, `/oas/${OA}/settings`, base)).toBe(false);
    expect(isSidebarItemActive(item("利用プラン")!, "/pricing", base)).toBe(false);
    expect(isSidebarItemActive(item("ロケーション")!, `/oas/${OA}/locations`, base)).toBe(false);
  });
  it("メッセージ: /messages 配下で active", () => {
    expect(isSidebarItemActive(item("メッセージ")!, `${base}/messages/abc`, base)).toBe(true);
  });
});
