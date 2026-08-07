// src/__tests__/work-sidebar-nav.test.ts
import { describe, it, expect } from "vitest";
import { buildWorkSidebarSections, isSidebarItemActive } from "@/app/oas/[id]/_lib/work-sidebar-nav";

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

  it("主要機能は7項目（ビーコンを含む）", () => {
    expect(sec("主要機能")!.items.map((i) => i.label))
      .toEqual(["フェーズ", "キャラクター", "メッセージ", "LIFF", "オーディエンス", "ロケーション", "ビーコン"]);
  });

  it("ビーコン = OA 階層 canonical /locations/beacons?workId=（実在 URL・workId 引き継ぎ）", () => {
    expect(item("ビーコン")!.href).toBe(`/oas/${OA}/locations/beacons?workId=${WORK}`);
    // external ではない（後方互換 /works/[workId]/beacons の pathname 判定を残すため）。
    expect(item("ビーコン")!.external).toBeUndefined();
  });
  it("ロケーション = OA 階層 canonical /locations?workId=（external・workId 引き継ぎ）", () => {
    expect(item("ロケーション")!.href).toBe(`/oas/${OA}/locations?workId=${WORK}`);
    expect(item("ロケーション")!.external).toBe(true);
  });
  it("全項目に一意な key が付与されている", () => {
    const keys = allItems().map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("beacons");
    expect(keys).toContain("locations");
  });
});

describe("遷移先 URL は既存を流用", () => {
  it("作品設定 = 旧作品情報の /edit（不変）", () => {
    expect(item("作品設定")!.href).toBe(`${base}/edit`);
  });
  it("アカウント設定 = 作品配下 in-layout（サイドバー維持）", () => {
    expect(item("アカウント設定")!.href).toBe(`${base}/account-settings`);
    expect(item("アカウント設定")!.external).toBeUndefined();
  });
  it("利用プラン = 作品配下 in-layout（サイドバー維持）", () => {
    expect(item("利用プラン")!.href).toBe(`${base}/pricing`);
    expect(item("利用プラン")!.external).toBeUndefined();
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
  it("アカウント設定: /account-settings で active（in-layout でサイドバー維持）", () => {
    expect(isSidebarItemActive(item("アカウント設定")!, `${base}/account-settings`, base)).toBe(true);
    expect(isSidebarItemActive(item("アカウント設定")!, base, base)).toBe(false);
  });
  it("利用プラン: /pricing で active（in-layout でサイドバー維持）", () => {
    expect(isSidebarItemActive(item("利用プラン")!, `${base}/pricing`, base)).toBe(true);
    expect(isSidebarItemActive(item("利用プラン")!, `${base}/edit`, base)).toBe(false);
  });
  it("external（ロケーション）は常に非active", () => {
    expect(isSidebarItemActive(item("ロケーション")!, `/oas/${OA}/locations`, base)).toBe(false);
  });
  it("メッセージ: /messages 配下で active", () => {
    expect(isSidebarItemActive(item("メッセージ")!, `${base}/messages/abc`, base)).toBe(true);
  });
  it("ビーコン: 後方互換 /works/[workId]/beacons 配下で active（pathname 判定）", () => {
    const b = item("ビーコン")!;
    expect(isSidebarItemActive(b, `${base}/beacons`, base)).toBe(true);
    expect(isSidebarItemActive(b, `${base}/beacons/new`, base)).toBe(true);
    expect(isSidebarItemActive(b, `${base}/beacons/bcn1/edit`, base)).toBe(true);
    expect(isSidebarItemActive(b, `${base}/audience`, base)).toBe(false);
  });
});

// OA 階層の現地トリガー画面（pathname から作品ベースを判定できない）は activeKey で判定する。
describe("isSidebarItemActive — OA 階層 activeKey 判定", () => {
  const loc = item("ロケーション")!;
  const bcn = item("ビーコン")!;
  const oaPath = `/oas/${OA}/locations`; // pathname は OA 階層（base とは無関係）

  it('/locations?workId= → activeKey="locations" で ロケーション のみ active', () => {
    expect(isSidebarItemActive(loc, oaPath, base, "locations")).toBe(true);
    expect(isSidebarItemActive(bcn, oaPath, base, "locations")).toBe(false);
  });

  it('/locations/beacons?workId= → activeKey="beacons" で ビーコン のみ active', () => {
    const p = `${oaPath}/beacons`;
    expect(isSidebarItemActive(bcn, p, base, "beacons")).toBe(true);
    expect(isSidebarItemActive(loc, p, base, "beacons")).toBe(false);
  });

  it("beacons 配下（new / [id]/edit / logs）でも activeKey=beacons で ビーコン active・ロケーションと同時に active にならない", () => {
    for (const p of [`${oaPath}/beacons/new`, `${oaPath}/beacons/bcn1/edit`, `${oaPath}/beacons/logs`]) {
      expect(isSidebarItemActive(bcn, p, base, "beacons")).toBe(true);
      expect(isSidebarItemActive(loc, p, base, "beacons")).toBe(false);
    }
  });

  it("activeKey 指定時は external でもキー一致で active（ロケーションは external だが activeKey で active）", () => {
    expect(loc.external).toBe(true);
    expect(isSidebarItemActive(loc, oaPath, base, "locations")).toBe(true);
  });

  it("activeKey 指定時、作品トップ等の pathname 判定は無効化され key 一致のみで判定", () => {
    const top = item("作品トップ")!;
    // pathname が base 完全一致でも、activeKey が別なら active にしない（key で判定）。
    expect(isSidebarItemActive(top, base, base, "locations")).toBe(false);
    expect(isSidebarItemActive(top, base, base, "top")).toBe(true);
  });
});

// ── FOR ウズプロ セクション（アクセス権限保有時のみ） ───────────────────────────
describe("FOR ウズプロ セクション", () => {
  const buildUzu = (uzuProAccess: boolean) =>
    buildWorkSidebarSections({ oaId: OA, workId: WORK, isTester: false, uzuProAccess });
  const uzuSection = (access: boolean) => buildUzu(access).find((s) => s.heading === "FOR ウズプロ");

  it("権限なしではセクションごと出さない", () => {
    expect(uzuSection(false)).toBeUndefined();
    expect(buildUzu(false).flatMap((s) => s.items).some((i) => i.label === "チケット連携")).toBe(false);
  });

  it("権限ありなら 連携状況 / プレイヤー / チケット連携 の 3 項目", () => {
    expect(uzuSection(true)!.items.map((i) => i.label)).toEqual([
      "連携状況", "プレイヤー", "チケット連携",
    ]);
  });

  it("チケット連携の遷移先は for ウズプロ配下（LIFF 設定タブとは別）", () => {
    const it_ = uzuSection(true)!.items.find((i) => i.label === "チケット連携")!;
    expect(it_.href).toBe(`${base}/uzu-pro/ticket-links`);
    expect(it_.key).toBe("uzupro-ticket-links");
    expect(it_.external).toBeUndefined();
  });

  it("チケット連携は自分のパスでのみ active（他の for ウズプロ項目と干渉しない）", () => {
    const items = uzuSection(true)!.items;
    const ticket = items.find((i) => i.label === "チケット連携")!;
    const status = items.find((i) => i.label === "連携状況")!;
    const player = items.find((i) => i.label === "プレイヤー")!;

    expect(isSidebarItemActive(ticket, `${base}/uzu-pro/ticket-links`, base)).toBe(true);
    expect(isSidebarItemActive(status, `${base}/uzu-pro/ticket-links`, base)).toBe(false);
    expect(isSidebarItemActive(player, `${base}/uzu-pro/ticket-links`, base)).toBe(false);
    expect(isSidebarItemActive(ticket, `${base}/uzu-pro/player`, base)).toBe(false);
  });

  it("key は全体で一意のまま", () => {
    const keys = buildUzu(true).flatMap((s) => s.items).map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
