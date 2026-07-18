// src/__tests__/live-ticket-link.test.ts
// チケットリンクトークンの純粋ロジック（生成/ハッシュ/状態/期限/URL/マスク/遅延解決）のテスト。
import { describe, it, expect } from "vitest";
import {
  generateTicketToken, hashTicketToken, ticketTokenState, resolveTicketExpiresAt,
  buildTicketLiffUrl, maskTicketId, pickMatchingTeam, TICKET_TOKEN_MAX_DAYS,
} from "@/lib/live-ticket-link";

describe("token 生成 / ハッシュ", () => {
  it("URL-safe（base64url 文字のみ）で十分な長さ", () => {
    const t = generateTicketToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(40); // 32byte→43char
    expect(generateTicketToken()).not.toBe(generateTicketToken()); // ランダム
  });
  it("平文と hash は異なり、同じ平文は同じ hash、異なる平文は異なる hash（sha256 hex 64）", () => {
    const t = "sample-token-value";
    const h = hashTicketToken(t);
    expect(h).not.toBe(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTicketToken(t)).toBe(h);
    expect(hashTicketToken("other")).not.toBe(h);
  });
});

describe("ticketTokenState", () => {
  const now = new Date("2026-08-01T00:00:00Z");
  it("有効 / 期限切れ / 失効 / none", () => {
    expect(ticketTokenState({ expiresAt: new Date("2026-09-01T00:00:00Z"), revokedAt: null }, now)).toBe("active");
    expect(ticketTokenState({ expiresAt: new Date("2026-07-01T00:00:00Z"), revokedAt: null }, now)).toBe("expired");
    expect(ticketTokenState({ expiresAt: new Date("2026-09-01T00:00:00Z"), revokedAt: new Date("2026-07-15T00:00:00Z") }, now)).toBe("revoked");
    expect(ticketTokenState(null, now)).toBe("none");
  });
});

describe("resolveTicketExpiresAt（優先順位・上限）", () => {
  const now = new Date("2026-08-01T00:00:00Z");
  it("公演日時ありは +3日", () => {
    const startsAt = new Date("2026-08-20T09:00:00Z");
    const got = resolveTicketExpiresAt({ startsAt, now });
    expect(got.toISOString()).toBe(new Date("2026-08-23T09:00:00Z").toISOString());
  });
  it("公演日時なしは 発行+30日", () => {
    const got = resolveTicketExpiresAt({ startsAt: null, now });
    expect(got.toISOString()).toBe(new Date("2026-08-31T00:00:00Z").toISOString());
  });
  it("外部 requestedDays は優先され、上限にクランプされる", () => {
    expect(resolveTicketExpiresAt({ startsAt: new Date("2026-08-20T00:00:00Z"), requestedDays: 5, now }).toISOString())
      .toBe(new Date("2026-08-06T00:00:00Z").toISOString());
    const capped = resolveTicketExpiresAt({ requestedDays: 9999, now });
    expect(capped.toISOString()).toBe(new Date(now.getTime() + TICKET_TOKEN_MAX_DAYS * 86400000).toISOString());
  });
});

describe("buildTicketLiffUrl / maskTicketId", () => {
  it("URL に生 ticketId を載せずトークンのみ", () => {
    expect(buildTicketLiffUrl("1234567890-abcdef", "TOK")).toBe("https://liff.line.me/1234567890-abcdef/ticket?t=TOK");
  });
  it("マスク: 先頭3〜4 + 末尾2・中間 *", () => {
    expect(maskTicketId("BEL-123456")).toBe("BEL-****56");
    expect(maskTicketId("AB12")).toBe("****");          // 短い ID は過剰露出しない
    expect(maskTicketId("")).toBe("****");
    expect(maskTicketId(null)).toBe("****");
    const m = maskTicketId("ESCAPE2026000123");
    expect(m.startsWith("ESCA")).toBe(true);
    expect(m.endsWith("23")).toBe(true);
    expect(m).toContain("*");
  });
});

describe("pickMatchingTeam（reservationNumber 主 → ticketId フォールバック・矛盾/曖昧は拒否）", () => {
  const teams = [
    { id: "t1", reservationNumber: "R-100", ticketId: "BEL-1" },
    { id: "t2", reservationNumber: "R-200", ticketId: "BEL-2" },
  ];
  it("reservationNumber で一致（正規化：ハイフン/大文字無視）", () => {
    expect(pickMatchingTeam(teams, { reservationNumber: "r100", ticketId: null })).toEqual({ kind: "ok", team: teams[0] });
  });
  it("reservationNumber 不一致なら ticketId でフォールバック", () => {
    expect(pickMatchingTeam(teams, { reservationNumber: "R-999", ticketId: "bel2" })).toEqual({ kind: "ok", team: teams[1] });
  });
  it("複数一致は ambiguous（勝手に先頭採用しない）", () => {
    const dup = [{ id: "t1", reservationNumber: "R-100", ticketId: null }, { id: "t3", reservationNumber: "R-100", ticketId: null }];
    expect(pickMatchingTeam(dup, { reservationNumber: "R-100", ticketId: null }).kind).toBe("ambiguous");
  });
  it("reservationNumber と ticketId が別 team に一致すると conflict", () => {
    expect(pickMatchingTeam(teams, { reservationNumber: "R-100", ticketId: "BEL-2" }).kind).toBe("conflict");
  });
  it("どちらも一致しなければ not_found", () => {
    expect(pickMatchingTeam(teams, { reservationNumber: "R-XXX", ticketId: "BEL-9" }).kind).toBe("not_found");
  });
  it("同一 team に両キーが一致するなら conflict ではなく ok", () => {
    expect(pickMatchingTeam(teams, { reservationNumber: "R-100", ticketId: "BEL-1" })).toEqual({ kind: "ok", team: teams[0] });
  });
});
