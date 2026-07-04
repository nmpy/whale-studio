// src/__tests__/member-line-link.test.ts
// 会員 LINE 連携コードの形式判定＋トークン消費ロジックの検証。
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockToken, mockMember } = vi.hoisted(() => ({
  mockToken:  { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  mockMember: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    memberLineLinkToken: mockToken,
    workspaceMember: mockMember,
    $transaction: (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
  },
}));

import {
  isMemberLinkCode, generateLinkCode, hashLinkCode, consumeMemberLinkCode, MEMBER_LINK_PREFIX,
} from "@/lib/member-line-link";

const CODE = "WS-LINE-LINK-ABCDEFGH";
const HASH = hashLinkCode(CODE);
const NOW  = new Date("2026-07-05T00:00:00.000Z");
const future = new Date(NOW.getTime() + 10 * 60 * 1000);
const past   = new Date(NOW.getTime() - 1 * 60 * 1000);

describe("isMemberLinkCode — 完全一致のみ横取り", () => {
  it("正しい形式は true", () => {
    expect(isMemberLinkCode("WS-LINE-LINK-ABCDEFGH")).toBe(true);
    expect(isMemberLinkCode("  WS-LINE-LINK-ABCDEFGH  ")).toBe(true); // 前後空白は許容
  });
  it("通常メッセージ/謎解き回答/部分一致は false（シナリオ処理へ流す）", () => {
    expect(isMemberLinkCode("次へ")).toBe(false);
    expect(isMemberLinkCode("ものがたりのしんじつをしる")).toBe(false);
    expect(isMemberLinkCode("WS-LINE-LINK-")).toBe(false);          // body なし
    expect(isMemberLinkCode("WS-LINE-LINK-ABCDEFG")).toBe(false);   // 7桁（短い）
    expect(isMemberLinkCode("WS-LINE-LINK-ABCDEFGHX")).toBe(false); // 9桁（長い）
    expect(isMemberLinkCode("WS-LINE-LINK-ABCDEF01")).toBe(false);  // 0/1 は alphabet 外
    expect(isMemberLinkCode("答えはWS-LINE-LINK-ABCDEFGHです")).toBe(false); // 埋め込み（完全一致でない）
    expect(isMemberLinkCode(null)).toBe(false);
    expect(isMemberLinkCode("")).toBe(false);
  });
});

describe("generateLinkCode / hashLinkCode", () => {
  it("生成コードは prefix 付きで isMemberLinkCode を満たす", () => {
    const c = generateLinkCode();
    expect(c.startsWith(MEMBER_LINK_PREFIX)).toBe(true);
    expect(isMemberLinkCode(c)).toBe(true);
  });
  it("hash は決定的で平文と異なる", () => {
    expect(hashLinkCode(CODE)).toBe(hashLinkCode(CODE));
    expect(hashLinkCode(CODE)).not.toBe(CODE);
    expect(hashLinkCode(CODE)).toHaveLength(64); // sha256 hex
  });
});

describe("consumeMemberLinkCode — トークン消費と UID 保存", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToken.findUnique.mockResolvedValue({ id: "t1", oaId: "oa1", userId: "u1", tokenHash: HASH, consumedAt: null, expiresAt: future });
    mockMember.findFirst.mockResolvedValue(null);                       // UID 未使用
    mockMember.findUnique.mockResolvedValue({ lineUserId: null });      // member は UID 未設定
    mockMember.update.mockResolvedValue({});
    mockToken.update.mockResolvedValue({});
  });

  it("正常: workspace_members.line_user_id に source.userId を保存し token を消費", async () => {
    const r = await consumeMemberLinkCode({ oaId: "oa1", code: CODE, lineUserId: "Uplayer001", now: NOW });
    expect(r.ok).toBe(true);
    expect(mockMember.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId_userId: { workspaceId: "oa1", userId: "u1" } },
      data:  { lineUserId: "Uplayer001" },
    }));
    expect(mockToken.update).toHaveBeenCalledWith(expect.objectContaining({ data: { consumedAt: NOW } }));
  });

  it("形式不一致 → invalid（DB を触らない）", async () => {
    const r = await consumeMemberLinkCode({ oaId: "oa1", code: "次へ", lineUserId: "U1", now: NOW });
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    expect(mockToken.findUnique).not.toHaveBeenCalled();
  });

  it("token 不在 → invalid", async () => {
    mockToken.findUnique.mockResolvedValue(null);
    expect(await consumeMemberLinkCode({ oaId: "oa1", code: CODE, lineUserId: "U1", now: NOW })).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("OA 不一致 → oa_mismatch（保存しない）", async () => {
    mockToken.findUnique.mockResolvedValue({ id: "t1", oaId: "OTHER", userId: "u1", consumedAt: null, expiresAt: future });
    const r = await consumeMemberLinkCode({ oaId: "oa1", code: CODE, lineUserId: "U1", now: NOW });
    expect(r).toMatchObject({ ok: false, reason: "oa_mismatch" });
    expect(mockMember.update).not.toHaveBeenCalled();
  });

  it("使用済み → consumed", async () => {
    mockToken.findUnique.mockResolvedValue({ id: "t1", oaId: "oa1", userId: "u1", consumedAt: past, expiresAt: future });
    expect(await consumeMemberLinkCode({ oaId: "oa1", code: CODE, lineUserId: "U1", now: NOW })).toMatchObject({ ok: false, reason: "consumed" });
  });

  it("期限切れ → expired", async () => {
    mockToken.findUnique.mockResolvedValue({ id: "t1", oaId: "oa1", userId: "u1", consumedAt: null, expiresAt: past });
    expect(await consumeMemberLinkCode({ oaId: "oa1", code: CODE, lineUserId: "U1", now: NOW })).toMatchObject({ ok: false, reason: "expired" });
  });

  it("同一 OA で UID が別メンバーに紐づき済み → uid_taken（重複登録拒否）", async () => {
    mockMember.findFirst.mockResolvedValue({ userId: "OTHER_MEMBER" });
    const r = await consumeMemberLinkCode({ oaId: "oa1", code: CODE, lineUserId: "Ushared", now: NOW });
    expect(r).toMatchObject({ ok: false, reason: "uid_taken" });
    expect(mockMember.update).not.toHaveBeenCalled();
  });

  it("対象メンバーが既に別 UID 設定済み → already_linked（再連携不可・token は消費）", async () => {
    mockMember.findUnique.mockResolvedValue({ lineUserId: "Uold" });
    const r = await consumeMemberLinkCode({ oaId: "oa1", code: CODE, lineUserId: "Unew", now: NOW });
    expect(r).toMatchObject({ ok: false, reason: "already_linked" });
    expect(mockMember.update).not.toHaveBeenCalled();
    expect(mockToken.update).toHaveBeenCalled(); // 使い回し防止で消費
  });
});
