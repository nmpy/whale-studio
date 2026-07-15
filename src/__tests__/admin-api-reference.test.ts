// src/__tests__/admin-api-reference.test.ts
//
// スタジオ管理「API連携」導線と /admin/api ページの仕様テスト（jsdom 不要・node env）。
// UI 壊れ防止の安全網。RTL は導入せず、既存の「ソース/データ仕様テスト」パターンに倣う。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ADMIN_NAV_ITEMS, visibleAdminNavItems } from "@/app/admin/_components/adminNavItems";

const PAGE_SRC = readFileSync("src/app/admin/api/page.tsx", "utf8");

describe("ADMIN_NAV_ITEMS: API連携 導線", () => {
  const item = ADMIN_NAV_ITEMS.find((i) => i.label === "API連携");

  it("API連携 項目が存在する", () => {
    expect(item).toBeDefined();
  });

  it("href が /admin/api", () => {
    expect(item?.href).toBe("/admin/api");
  });

  it("platformOnly=false（workspace owner にも表示）", () => {
    expect(item?.platformOnly).toBe(false);
  });

  it("非 platform ユーザーの表示一覧（FV カード / サイドバー共通）に含まれる", () => {
    const labels = visibleAdminNavItems(false).map((i) => i.label);
    expect(labels).toContain("API連携");
  });

  it("platform ユーザーの表示一覧にも含まれる", () => {
    expect(visibleAdminNavItems(true).map((i) => i.label)).toContain("API連携");
  });

  it("既存の platformOnly 表示制御を壊していない（platformOnly 項目は非 platform では非表示）", () => {
    const platformOnlyLabels = ADMIN_NAV_ITEMS.filter((i) => i.platformOnly).map((i) => i.label);
    const visibleToNonPlatform = visibleAdminNavItems(false).map((i) => i.label);
    for (const label of platformOnlyLabels) {
      expect(visibleToNonPlatform).not.toContain(label);
    }
    // 既存の非 platform 項目（操作ログ等）は引き続き表示される
    expect(visibleToNonPlatform).toContain("操作ログ");
    expect(visibleToNonPlatform).toContain("OA連携審査");
  });
});

describe("/admin/api ページ仕様（ソース検証）", () => {
  it("タイトルと概要が含まれる", () => {
    expect(PAGE_SRC).toContain("API連携");
    expect(PAGE_SRC).toContain("外部システムから作品・フェーズ情報を参照");
  });

  it("読み取り専用であることが明示される", () => {
    expect(PAGE_SRC).toContain("読み取り専用");
    expect(PAGE_SRC).toContain("作成・更新・削除することはできません");
  });

  it("x-whale-api-key 認証の説明が含まれる", () => {
    expect(PAGE_SRC).toContain("x-whale-api-key");
  });

  it("実装済みの3エンドポイントのみが記載される", () => {
    expect(PAGE_SRC).toContain("/api/external/v1/works");
    expect(PAGE_SRC).toContain("/api/external/v1/works/:workId/phases");
    expect(PAGE_SRC).toContain("/api/external/v1/works/:workId/phase-links");
    // 未実装/将来エンドポイントの痕跡がない
    expect(PAGE_SRC).not.toMatch(/POST|PUT|PATCH|DELETE/);
  });

  it("実装に存在するステータスコードのみ（400/403 は記載しない）", () => {
    for (const code of ["200", "401", "404", "500", "503"]) expect(PAGE_SRC).toContain(code);
    // このAPIは badRequest(400) / forbidden(403) を返さない
    expect(PAGE_SRC).not.toMatch(/["\s>]400["\s<]/);
    expect(PAGE_SRC).not.toMatch(/["\s>]403["\s<]/);
  });

  it("canonical 本番ドメインを表示し、preview/vercel.app/localhost をハードコードしない", () => {
    expect(PAGE_SRC).toContain("https://app.whale-studio.app");
    expect(PAGE_SRC).not.toContain("whale-studio.vercel.app");
    expect(PAGE_SRC).not.toContain("localhost");
    expect(PAGE_SRC).not.toContain("window.location");
  });

  it("実在するAPIキー/secret を含まない（ダミー値のみ）", () => {
    expect(PAGE_SRC).toContain("YOUR_API_KEY"); // ダミー
    // 秘密らしき実値パターンを含まない
    expect(PAGE_SRC).not.toMatch(/sk_live|whsec_|gho_|eyJ[A-Za-z0-9_-]{20,}/);
  });

  it("APIキー発行/再生成の操作 UI 文言を含まない（発行UIは無いため）", () => {
    expect(PAGE_SRC).not.toContain("APIキーを発行");
    expect(PAGE_SRC).not.toContain("APIキーを再生成");
    // 発行は運営問い合わせ案内
    expect(PAGE_SRC).toContain("運営管理者へお問い合わせ");
  });

  it("Server Component（use client 化していない）", () => {
    expect(PAGE_SRC.trimStart().startsWith('"use client"')).toBe(false);
  });
});
