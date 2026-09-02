// src/__tests__/liff-menu-href.test.ts
//
// メニューホームのカードの遷移先 href。
//
// 検索型ヒントだけ LIFF URL に遷移させ、LINE ネイティブの戻るボタンで元の画面へ
// 戻れるようにする（LIFF 間遷移）。それ以外は従来どおり相対パス。
//
// ★ 最重要: **env フォールバックの LIFF ID で URL を作らないこと**。
//   NEXT_PUBLIC_LIFF_ID はテスト用チャネル (whale-studio-test) の LIFF なので、
//   それで URL を組むとプレイヤーが別 OA の LIFF に飛ぶ（混線）。
//   呼び出し側は Oa.liffId 由来のときだけ値が入る liffIdForUrl を渡す契約。

import { describe, it, expect } from "vitest";
import { buildMenuPageHref, buildMenuPageRelativeHref } from "@/lib/liff/menu-href";

const OA_LIFF_ID = "2010632002-ZzzimCzc";   // D.O.T の Oa.liffId（実在の形）
const ENV_LIFF_ID = "2010049684-aJNy8Ljv";  // NEXT_PUBLIC_LIFF_ID = テスト用チャネル

const base = {
  workId: "work-uuid",
  workPublicId: "q6v7188co7",
  pageId: "page-uuid",
  pagePublicId: "k4sn8iz3i3",
};
const REL = "/liff/w/q6v7188co7/p/k4sn8iz3i3";
const LIFF_URL = `https://liff.line.me/${OA_LIFF_ID}/w/q6v7188co7/p/k4sn8iz3i3`;

describe("相対パス", () => {
  it("publicId が揃えば短縮ルート、無ければ UUID ルート", () => {
    expect(buildMenuPageRelativeHref(base)).toBe(REL);
    expect(buildMenuPageRelativeHref({ ...base, pagePublicId: null }))
      .toBe("/liff/work/work-uuid/pages/page-uuid");
  });
});

describe("検索型ヒントは LINE アプリ内で LIFF URL になる", () => {
  it("条件がすべて揃えば LIFF URL", () => {
    expect(buildMenuPageHref({
      ...base, pageType: "hint_search", liffIdForUrl: OA_LIFF_ID, isInClient: true,
    })).toBe(LIFF_URL);
  });

  it("他の page_type は相対パスのまま", () => {
    for (const t of ["default", "hint", "faq", "survey", "contact", "puzzle", "character", "ticket_link"]) {
      expect(buildMenuPageHref({
        ...base, pageType: t, liffIdForUrl: OA_LIFF_ID, isInClient: true,
      }), t).toBe(REL);
    }
  });

  // 外部ブラウザで liff.line.me を開くと LINE ログインへ飛ばされ、
  // 「ブラウザで確認」導線が壊れる。
  it("LINE アプリ外では相対パス", () => {
    expect(buildMenuPageHref({
      ...base, pageType: "hint_search", liffIdForUrl: OA_LIFF_ID, isInClient: false,
    })).toBe(REL);
    expect(buildMenuPageHref({
      ...base, pageType: "hint_search", liffIdForUrl: OA_LIFF_ID,
    })).toBe(REL);
  });

  it("publicId が欠けていれば相対パス（LIFF URL は短縮ルート前提）", () => {
    expect(buildMenuPageHref({
      ...base, pagePublicId: null, pageType: "hint_search",
      liffIdForUrl: OA_LIFF_ID, isInClient: true,
    })).toBe("/liff/work/work-uuid/pages/page-uuid");
  });
});

// ここが壊れると、Oa.liffId 未設定の OA のプレイヤーがテスト用チャネルの LIFF に飛ぶ。
// 本番には Oa.liffId 未設定の稼働中 OA が実在するため、実害が出る。
describe("★ 混線防止 — env フォールバックの LIFF ID で URL を作らない", () => {
  it("liffIdForUrl が無ければ LIFF URL を作らない（相対パスに落ちる）", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(buildMenuPageHref({
        ...base, pageType: "hint_search", liffIdForUrl: v as string | null, isInClient: true,
      }), String(v)).toBe(REL);
    }
  });

  it("生成された URL には必ず渡した Oa.liffId だけが入る", () => {
    const href = buildMenuPageHref({
      ...base, pageType: "hint_search", liffIdForUrl: OA_LIFF_ID, isInClient: true,
    });
    expect(href).toContain(OA_LIFF_ID);
    expect(href, "テスト用チャネルの LIFF ID が混入している").not.toContain(ENV_LIFF_ID);
  });

  // 呼び出し側の契約: hook は source="oa" のときだけ値を入れる。
  it("hook が env フォールバック時に null を渡す実装になっている", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/hooks/useWorkScopedLiff.ts"), "utf8");
    expect(src).toContain('resolution.source === "oa"');
    expect(src).toMatch(/liffIdForUrl[\s\S]{0,200}source === "oa"/);
  });

  it("メニュー画面は liffIdForUrl を渡している（生の liffId ではない）", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/components/liff/LiffMenuHomeViewer.tsx"), "utf8");
    expect(src).toContain("liffIdForUrl");
  });
});
