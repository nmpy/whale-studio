// src/__tests__/liff-ticket-entry.test.ts
// resolveTicketEntryToken の URL 解析（location.search / liff.state・URL 非変更・上限デコード）テスト。
import { describe, it, expect } from "vitest";
import { resolveTicketEntryToken } from "@/lib/liff/ticket-entry";

const TOK = "abcDEF012_-abcDEF012_-abcDEF012_-abcDEF012aa"; // base64url 43+ char 相当

describe("resolveTicketEntryToken", () => {
  it("通常の ?t= から取得", () => {
    expect(resolveTicketEntryToken(`https://app.example.com/liff/ticket?t=${TOK}`)).toBe(TOK);
  });
  it("liff.state（サブパス+クエリ）から取得", () => {
    expect(resolveTicketEntryToken(`https://app.example.com/liff?liff.state=${encodeURIComponent(`/ticket?t=${TOK}`)}`)).toBe(TOK);
  });
  it("多重 URL エンコードされた liff.state から取得（上限内）", () => {
    const once = encodeURIComponent(`/ticket?t=${TOK}`);
    const twice = encodeURIComponent(once);
    expect(resolveTicketEntryToken(`https://app.example.com/liff?liff.state=${twice}`)).toBe(TOK);
  });
  it("直 ?t= を liff.state より優先", () => {
    const url = `https://app.example.com/liff/ticket?t=${TOK}&liff.state=${encodeURIComponent("/ticket?t=OTHER000000000000")}`;
    expect(resolveTicketEntryToken(url)).toBe(TOK);
  });
  it("token が無ければ null", () => {
    expect(resolveTicketEntryToken("https://app.example.com/liff/ticket")).toBeNull();
    expect(resolveTicketEntryToken("https://app.example.com/liff?liff.state=%2Fticket")).toBeNull();
  });
  it("不正 URL / null / undefined は安全に null", () => {
    expect(resolveTicketEntryToken("not a url")).toBeNull();
    expect(resolveTicketEntryToken(null)).toBeNull();
    expect(resolveTicketEntryToken(undefined)).toBeNull();
  });
  it("トークン形状に合わない値は null（過剰な値を受理しない）", () => {
    expect(resolveTicketEntryToken("https://app.example.com/liff/ticket?t=short")).toBeNull();
    expect(resolveTicketEntryToken(`https://app.example.com/liff/ticket?t=${"x".repeat(300)}`)).toBeNull();
    expect(resolveTicketEntryToken("https://app.example.com/liff/ticket?t=has%20space%20and%21")).toBeNull();
  });
  it("liff.* パラメータを変更しない（入力 href を破壊しない・読み取り専用）", () => {
    const href = `https://app.example.com/liff?liff.state=${encodeURIComponent(`/ticket?t=${TOK}`)}&liff.referrer=x&lineAppVersion=1`;
    const before = href;
    resolveTicketEntryToken(href);
    expect(href).toBe(before); // 引数文字列は不変（純関数）
  });
});
