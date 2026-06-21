/**
 * src/__tests__/post-auth-redirect.test.ts
 * ログイン後の通常入口は、OA 数に関係なく必ずアカウントリスト /oas であることを固定する。
 * （/oas/page.tsx から「OA 1 件なら作品一覧へ自動 redirect」を撤去した仕様に対応。）
 */
import { describe, it, expect } from "vitest";
import { getPostAuthRedirect } from "@/lib/post-auth-redirect";

describe("getPostAuthRedirect — ログイン後の通常遷移先は /oas", () => {
  it("login → /oas（OA 数に依存せず必ずアカウントリスト）", () => {
    expect(getPostAuthRedirect({ source: "login" })).toBe("/oas");
  });
  it("reset-password → /oas", () => {
    expect(getPostAuthRedirect({ source: "reset-password" })).toBe("/oas");
  });
  it("invite（token あり）は招待ページへ戻す（既存挙動を維持）", () => {
    expect(getPostAuthRedirect({ source: "invite", token: "tok123" })).toBe("/invite/tok123");
  });
  it("invite（token なし）→ /oas にフォールバック", () => {
    expect(getPostAuthRedirect({ source: "invite" })).toBe("/oas");
  });
});
