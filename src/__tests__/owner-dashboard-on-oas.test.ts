// src/__tests__/owner-dashboard-on-oas.test.ts
// スタジオ全体ダッシュボードを /oas トップへ移設した際の純粋ロジックのテスト。
//   - /admin/dashboard → /oas の遷移先（認可維持・period 維持・既定/不正値の扱い）。
//   - redirect ページが認可判定前後で横断集計を実行しないこと（ソース確認）。
//   - /oas の platform owner 判定・横断集計の実行有無は認可 + Server Component + Preview が担保する。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ownerDashboardRedirectTarget,
  resolveAdminDashboardDestination,
  ADMIN_DASHBOARD_LOGIN_DEST,
  ADMIN_DASHBOARD_NON_OWNER_DEST,
} from "@/app/admin/dashboard/redirect-target";
import { normalizePeriod } from "@/lib/owner-dashboard/aggregate";
import { isWideContentRoute } from "@/lib/content-width";

describe("ownerDashboardRedirectTarget — /oas（period 維持）", () => {
  it("period 指定は維持して /oas?period= へ", () => {
    expect(ownerDashboardRedirectTarget("30d")).toBe("/oas?period=30d");
    expect(ownerDashboardRedirectTarget("month")).toBe("/oas?period=month");
  });
  it("既定(7d) は period を付けない", () => {
    expect(ownerDashboardRedirectTarget("7d")).toBe("/oas");
  });
  it("未指定・不正値は安全に既定（/oas）", () => {
    expect(ownerDashboardRedirectTarget(undefined)).toBe("/oas");
    expect(ownerDashboardRedirectTarget("")).toBe("/oas");
    expect(ownerDashboardRedirectTarget("weird")).toBe("/oas");
    expect(ownerDashboardRedirectTarget("../evil")).toBe("/oas");
  });
});

describe("resolveAdminDashboardDestination — 移設前と同一の認可を維持", () => {
  it("platform owner: period を維持して /oas へ", () => {
    expect(resolveAdminDashboardDestination({ hasUser: true, isPlatformOwner: true, rawPeriod: "30d" })).toBe("/oas?period=30d");
    expect(resolveAdminDashboardDestination({ hasUser: true, isPlatformOwner: true, rawPeriod: undefined })).toBe("/oas");
    expect(resolveAdminDashboardDestination({ hasUser: true, isPlatformOwner: true, rawPeriod: "month" })).toBe("/oas?period=month");
  });
  it("workspace owner / 通常ユーザー（= 非 platform owner）: 移設前と同じ /admin/announcements（/oas へは行かない）", () => {
    const dest = resolveAdminDashboardDestination({ hasUser: true, isPlatformOwner: false, rawPeriod: "30d" });
    expect(dest).toBe(ADMIN_DASHBOARD_NON_OWNER_DEST);
    expect(dest).toBe("/admin/announcements");
    expect(dest.startsWith("/oas")).toBe(false); // platform owner 向け redirect を経由しない
  });
  it("未認証: 移設前と同じ /login?next=/admin/dashboard へ安全に誘導", () => {
    expect(resolveAdminDashboardDestination({ hasUser: false, isPlatformOwner: false, rawPeriod: undefined })).toBe(ADMIN_DASHBOARD_LOGIN_DEST);
    // hasUser=false のときは isPlatformOwner の値に関わらずログインへ
    expect(resolveAdminDashboardDestination({ hasUser: false, isPlatformOwner: true, rawPeriod: "30d" })).toBe("/login?next=/admin/dashboard");
  });
  it("不正 period でも非 owner 判定が優先（集計・遷移先が安全）", () => {
    expect(resolveAdminDashboardDestination({ hasUser: true, isPlatformOwner: false, rawPeriod: "nope" })).toBe("/admin/announcements");
  });
});

describe("/admin/dashboard redirect ページは横断集計を実行しない", () => {
  it("page.tsx が getOwnerDashboard / getOwnerActivity を import・呼び出ししていない", () => {
    const src = readFileSync("src/app/admin/dashboard/page.tsx", "utf8");
    expect(src).not.toContain("getOwnerDashboard");
    expect(src).not.toContain("getOwnerActivity");
    // 認可判定に必要な要素は含む
    expect(src).toContain("getServerUser");
    expect(src).toContain("isPlatformOwner");
    expect(src).toContain("resolveAdminDashboardDestination");
  });
});

describe("isWideContentRoute — /oas だけ wide(1200px)・他ページに漏れない", () => {
  it("/oas 完全一致のみ wide", () => {
    expect(isWideContentRoute("/oas")).toBe(true);
  });
  it("/oas 配下・新規作成・その他管理画面は wide にしない（980px 維持）", () => {
    for (const p of [
      "/oas/new", "/oas/abc12345", "/oas/abc12345/works",
      "/admin/error-log", "/admin/dashboard", "/admin/announcements",
      "/login", "/", "/liff", "/whale/in-ice", null, undefined,
    ]) {
      expect(isWideContentRoute(p)).toBe(false);
    }
  });
});

describe("AppShell — wide 指定は /oas 判定に基づき、グローバル .container は不変", () => {
  it("AppShell は isWideContentRoute で container-wide を出し分ける", () => {
    const src = readFileSync("src/components/AppShell.tsx", "utf8");
    expect(src).toContain("isWideContentRoute(pathname)");
    expect(src).toContain("container container-wide");
  });
  it("globals.css の .container(980px) は変更せず、.container-wide(1200px) を追加", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(".container { max-width: 980px;");
    expect(css).toContain(".container-wide { max-width: 1200px; }");
  });
});

describe("/oas ページ構成 — ダッシュボード上・一覧下・サマリー表非表示・お知らせは一覧側のみ", () => {
  const src = readFileSync("src/app/oas/page.tsx", "utf8");
  it("platform owner 判定はサーバー（getServerUser + isPlatformOwner）", () => {
    expect(src).toContain("getServerUser");
    expect(src).toContain("isPlatformOwner");
  });
  it("owner のみ横断集計（getOwnerDashboard/Activity を条件下で実行）", () => {
    expect(src).toContain("getOwnerDashboard");
    expect(src).toContain("getOwnerActivity");
    expect(src).toContain("if (isOwner)");
  });
  it("ダッシュボードは showAccountSummary=false・accountListHref=null で描画", () => {
    expect(src).toContain("showAccountSummary={false}");
    expect(src).toContain("accountListHref={null}");
  });
  it("OaListClient は常に描画（owner/非owner とも一覧を表示）", () => {
    expect(src).toContain("<OaListClient />");
  });
  it("お知らせ帯（AnnouncementBanner）はページ側に持たない（OaListClient 内で1回）", () => {
    expect(src).not.toContain("AnnouncementBanner");
  });
});

describe("normalizePeriod — /oas でも同じ period 正規化を共有", () => {
  it("有効値はそのまま・不正は 7d", () => {
    expect(normalizePeriod("7d")).toBe("7d");
    expect(normalizePeriod("30d")).toBe("30d");
    expect(normalizePeriod("month")).toBe("month");
    expect(normalizePeriod(undefined)).toBe("7d");
    expect(normalizePeriod("nope")).toBe("7d");
  });
});
