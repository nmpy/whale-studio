/**
 * src/__tests__/liff-menu-href.test.ts
 *
 * 作品メニューホームのカード href の決定ロジック。
 *
 * 検索型ヒント (hint_search) だけ LINE アプリ内で LIFF URL に遷移させる（= LIFF 間遷移で
 * LINE ネイティブの戻るボタンを出す）。それ以外の条件では従来の相対パスのままであること
 * （＝既存ページの遷移 UX を変えていないこと）を固定する。
 */
import { describe, it, expect } from "vitest";
import { buildMenuPageHref, buildMenuPageRelativeHref } from "@/lib/liff/menu-href";

const BASE = {
  workId:       "w-uuid",
  workPublicId: "wp123",
  pageId:       "p-uuid",
  pagePublicId: "pp456",
  liffId:       "1234567890-abcdefgh",
};

describe("buildMenuPageRelativeHref", () => {
  it("publicId が揃えば短縮ルート", () => {
    expect(buildMenuPageRelativeHref(BASE)).toBe("/liff/w/wp123/p/pp456");
  });

  it("publicId が無ければ UUID ルート", () => {
    expect(buildMenuPageRelativeHref({ workId: "w-uuid", pageId: "p-uuid" }))
      .toBe("/liff/work/w-uuid/pages/p-uuid");
  });
});

describe("buildMenuPageHref — hint_search（LIFF 間遷移の対象）", () => {
  it("LINE アプリ内 + liffId 解決済みなら LIFF URL", () => {
    expect(buildMenuPageHref({ ...BASE, pageType: "hint_search", isInClient: true }))
      .toBe("https://liff.line.me/1234567890-abcdefgh/w/wp123/p/pp456");
  });

  it("publicId が無い旧ルートでも LIFF URL の sub-path になる", () => {
    expect(buildMenuPageHref({
      workId: "w-uuid", pageId: "p-uuid", liffId: BASE.liffId,
      pageType: "hint_search", isInClient: true,
    })).toBe("https://liff.line.me/1234567890-abcdefgh/work/w-uuid/pages/p-uuid");
  });

  it("LINE 外ブラウザ（実機確認用 URL 等）では相対パスのまま", () => {
    // 外部ブラウザで liff.line.me を開くと LINE ログインへリダイレクトされ確認導線が壊れる。
    expect(buildMenuPageHref({ ...BASE, pageType: "hint_search", isInClient: false }))
      .toBe("/liff/w/wp123/p/pp456");
  });

  it("liffId が未解決なら相対パスにフォールバック", () => {
    expect(buildMenuPageHref({ ...BASE, liffId: null, pageType: "hint_search", isInClient: true }))
      .toBe("/liff/w/wp123/p/pp456");
  });
});

describe("buildMenuPageHref — 他の page_type は従来どおり相対パス", () => {
  it.each(["faq", "survey", "contact", "puzzle", "ticket_link", "hint", null, undefined])(
    "page_type=%s は LINE アプリ内でも相対パス",
    (pageType) => {
      expect(buildMenuPageHref({ ...BASE, pageType: pageType as string | null, isInClient: true }))
        .toBe("/liff/w/wp123/p/pp456");
    },
  );
});
