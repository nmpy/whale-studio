/**
 * src/__tests__/member-invite.test.ts
 * 招待URL(MemberInvite) のトークン/状態判定ヘルパーの検証。
 */
import { describe, it, expect } from "vitest";
import {
  generateMemberInviteToken, hashMemberInviteToken,
  resolveMemberInviteExpiresAt, memberInviteStatus,
} from "@/lib/member-invite";

describe("member-invite helpers", () => {
  it("token は十分長く毎回異なる / hash は決定的な sha256 hex(64)", () => {
    const a = generateMemberInviteToken();
    const b = generateMemberInviteToken();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b); // ランダム
    const h = hashMemberInviteToken(a);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashMemberInviteToken(a)).toBe(h); // 決定的
    expect(hashMemberInviteToken(b)).not.toBe(h);
  });

  it("resolveMemberInviteExpiresAt: 日数指定で期限、null/0以下は無期限", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(resolveMemberInviteExpiresAt(now, 7)?.toISOString()).toBe("2026-01-08T00:00:00.000Z");
    expect(resolveMemberInviteExpiresAt(now, null)).toBeNull();
    expect(resolveMemberInviteExpiresAt(now, 0)).toBeNull();
  });

  it("memberInviteStatus: revoked > accepted > expired > pending の優先順", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    const past = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-12-31T00:00:00Z");
    // revoked が最優先（accepted/expired でも）
    expect(memberInviteStatus({ acceptedAt: now, revokedAt: now, expiresAt: past }, now)).toBe("revoked");
    // accepted（未失効）
    expect(memberInviteStatus({ acceptedAt: past, revokedAt: null, expiresAt: future }, now)).toBe("accepted");
    // expired（未受諾・未失効・期限切れ）
    expect(memberInviteStatus({ acceptedAt: null, revokedAt: null, expiresAt: past }, now)).toBe("expired");
    // pending（無期限）
    expect(memberInviteStatus({ acceptedAt: null, revokedAt: null, expiresAt: null }, now)).toBe("pending");
    // pending（未来期限）
    expect(memberInviteStatus({ acceptedAt: null, revokedAt: null, expiresAt: future }, now)).toBe("pending");
  });
});
