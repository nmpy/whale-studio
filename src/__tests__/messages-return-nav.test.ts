// src/__tests__/messages-return-nav.test.ts
// メッセージ作成/編集の「元タブへ戻る」ナビ補助の検証。
import { describe, it, expect } from "vitest";
import { isSafeTabToken, safeReturnTo, buildMessagesReturnHref, withReturnTab } from "@/app/oas/[id]/works/[workId]/messages/_return-nav";

const BASE = "/oas/oa1/works/w1/messages";

describe("isSafeTabToken", () => {
  it("all / __unassigned / UUID を許可", () => {
    expect(isSafeTabToken("all")).toBe(true);
    expect(isSafeTabToken("__unassigned")).toBe(true);
    expect(isSafeTabToken("3b941fc3-92fb-8106-a066-3783015166d4")).toBe(true);
  });
  it("空・スラッシュ・空白・長すぎは拒否", () => {
    expect(isSafeTabToken("")).toBe(false);
    expect(isSafeTabToken(null)).toBe(false);
    expect(isSafeTabToken(undefined)).toBe(false);
    expect(isSafeTabToken("a/b")).toBe(false);
    expect(isSafeTabToken("a b")).toBe(false);
    expect(isSafeTabToken("x".repeat(65))).toBe(false);
  });
});

describe("safeReturnTo（同一アプリ相対パスのみ）", () => {
  it("先頭スラッシュの相対パスは許可", () => {
    expect(safeReturnTo("/oas/oa1/works/w1/messages?tab=abc")).toBe("/oas/oa1/works/w1/messages?tab=abc");
  });
  it("外部URL / protocol-relative / スキーム / バックスラッシュ / 制御文字 / 非先頭スラッシュは拒否", () => {
    expect(safeReturnTo("https://evil.com")).toBeNull();
    expect(safeReturnTo("//evil.com")).toBeNull();
    expect(safeReturnTo("/x://y")).toBeNull();
    expect(safeReturnTo("/a\\b")).toBeNull();
    expect(safeReturnTo("/a\nb")).toBeNull();
    expect(safeReturnTo("messages?tab=abc")).toBeNull();
    expect(safeReturnTo("")).toBeNull();
    expect(safeReturnTo(null)).toBeNull();
  });
});

describe("buildMessagesReturnHref（優先順位 returnTo > returnTab > base）", () => {
  it("安全な returnTo があれば最優先", () => {
    expect(buildMessagesReturnHref(BASE, { returnTo: "/oas/oa1/works/w1/messages?tab=img", returnTab: "text" }))
      .toBe("/oas/oa1/works/w1/messages?tab=img");
  });
  it("不正な returnTo は無視して returnTab を使う", () => {
    expect(buildMessagesReturnHref(BASE, { returnTo: "https://evil.com", returnTab: "text" }))
      .toBe(`${BASE}?tab=text`);
  });
  it("returnTab のみなら ?tab= を付与", () => {
    expect(buildMessagesReturnHref(BASE, { returnTab: "all" })).toBe(`${BASE}?tab=all`);
  });
  it("どちらも無ければ base（既存URL互換）", () => {
    expect(buildMessagesReturnHref(BASE, {})).toBe(BASE);
    expect(buildMessagesReturnHref(BASE, { returnTab: null, returnTo: null })).toBe(BASE);
  });
  it("不正な returnTab はフォールバックして base", () => {
    expect(buildMessagesReturnHref(BASE, { returnTab: "a/b" })).toBe(BASE);
  });
});

describe("withReturnTab（編集/作成リンクに現在タブを付与）", () => {
  it("クエリ無しの href に ?returnTab= を付与", () => {
    expect(withReturnTab(`${BASE}/new`, "image")).toBe(`${BASE}/new?returnTab=image`);
  });
  it("既にクエリがある href には & で付与", () => {
    expect(withReturnTab(`${BASE}/new?x=1`, "text")).toBe(`${BASE}/new?x=1&returnTab=text`);
  });
  it("all も付与する（保存後 all に戻すため）", () => {
    expect(withReturnTab(`${BASE}/m1`, "all")).toBe(`${BASE}/m1?returnTab=all`);
  });
  it("不正なタブ値は付与しない（リンクは素のまま）", () => {
    expect(withReturnTab(`${BASE}/new`, "a/b")).toBe(`${BASE}/new`);
    expect(withReturnTab(`${BASE}/new`, "")).toBe(`${BASE}/new`);
    expect(withReturnTab(`${BASE}/new`, null)).toBe(`${BASE}/new`);
  });
});
