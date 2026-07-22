// src/__tests__/uzupro-manual-line-link.test.ts
// 手動登録/解除サービス（@/lib/uzupro/line-link）のユニット（prisma mock / fakeTx 駆動）:
//   manualLinkPlayerLineUser  … player 解決 → 予約+作品 FOR UPDATE → 有効再検証 → 冪等/競合/重複/compare-and-set(MANUAL)
//   manualUnlinkPlayerLineUser… player 解決 → 予約 FOR UPDATE → LINE のみ解除 + linked リンクを issued へ（URL 失効しない）
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const { mp } = vi.hoisted(() => ({
  mp: {
    uzuProPlayer: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));

import { manualLinkPlayerLineUser, manualUnlinkPlayerLineUser } from "@/lib/uzupro/line-link";

const OA = "oa1";
const WORK = "w1";
const PLAYER = "p1";
const BOOKING = "b1";
const UID = "U0123456789abcdef0123456789abcdef";
const OTHER = "Uffffffffffffffffffffffffffffffff";

beforeEach(() => vi.clearAllMocks());

// tx: 予約行 FOR UPDATE + 作品行 FOR UPDATE(uzu_pro_enabled) + プレイヤー現在値/重複 + 更新群。
function fakeTx(over: {
  workEnabled?: boolean;
  playerCurrent?: unknown;
  dup?: unknown;
  updateCount?: number;
} = {}) {
  const queryRaw = vi.fn();
  queryRaw
    .mockResolvedValueOnce([{ id: BOOKING }]) // bookings FOR UPDATE
    .mockResolvedValueOnce([{ uzu_pro_enabled: over.workEnabled ?? true }]); // works FOR UPDATE
  const findFirst = vi.fn();
  findFirst
    .mockResolvedValueOnce(over.playerCurrent === undefined ? { lineUserId: null } : over.playerCurrent) // 現在値
    .mockResolvedValueOnce(over.dup === undefined ? null : over.dup); // 重複チェック
  return {
    $queryRaw: queryRaw,
    uzuProPlayer: { findFirst, updateMany: vi.fn().mockResolvedValue({ count: over.updateCount ?? 1 }) },
    uzuProLiffLink: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  } as unknown as Prisma.TransactionClient & {
    $queryRaw: ReturnType<typeof vi.fn>;
    uzuProPlayer: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    uzuProLiffLink: { updateMany: ReturnType<typeof vi.fn> };
  };
}
const runWith = (tx: ReturnType<typeof fakeTx>) =>
  mp.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
const resolveOk = () => mp.uzuProPlayer.findFirst.mockResolvedValueOnce({ id: PLAYER, bookingId: BOOKING });

const linkArgs = { oaId: OA, workId: WORK, playerId: PLAYER, lineUserId: UID };

describe("manualLinkPlayerLineUser", () => {
  it("player 未解決（テナント/作品越境）→ player_not_found、tx を開かない", async () => {
    mp.uzuProPlayer.findFirst.mockResolvedValueOnce(null);
    expect(await manualLinkPlayerLineUser(linkArgs)).toEqual({ kind: "player_not_found" });
    expect(mp.$transaction).not.toHaveBeenCalled();
    // 解決 where は client 申告ではなく player→booking→work を辿る。
    expect(mp.uzuProPlayer.findFirst.mock.calls[0][0].where).toMatchObject({ id: PLAYER, oaId: OA, booking: { workId: WORK } });
  });

  it("初回 → linked、MANUAL で compare-and-set、予約+作品を FOR UPDATE", async () => {
    resolveOk();
    const tx = fakeTx({ playerCurrent: { lineUserId: null }, updateCount: 1 });
    runWith(tx);
    expect(await manualLinkPlayerLineUser(linkArgs)).toEqual({ kind: "linked" });
    expect(tx.uzuProPlayer.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: PLAYER, lineUserId: null },
      data: { lineUserId: UID, lineLinkSource: "MANUAL" },
    });
    const s0 = (tx.$queryRaw.mock.calls[0][0] as unknown as string[]).join(" ");
    const s1 = (tx.$queryRaw.mock.calls[1][0] as unknown as string[]).join(" ");
    expect(s0).toContain("uzu_pro_bookings"); expect(s0).toContain("FOR UPDATE");
    expect(s1).toContain("works"); expect(s1).toContain("uzu_pro_enabled"); expect(s1).toContain("FOR UPDATE");
  });

  it("作品無効（再検証で false）→ work_disabled、更新しない", async () => {
    resolveOk();
    const tx = fakeTx({ workEnabled: false });
    runWith(tx);
    expect(await manualLinkPlayerLineUser(linkArgs)).toEqual({ kind: "work_disabled" });
    expect(tx.uzuProPlayer.updateMany).not.toHaveBeenCalled();
  });

  it("同一 UID 冪等 → already_linked_same、上書きしない", async () => {
    resolveOk();
    const tx = fakeTx({ playerCurrent: { lineUserId: UID } });
    runWith(tx);
    expect(await manualLinkPlayerLineUser(linkArgs)).toEqual({ kind: "already_linked_same" });
    expect(tx.uzuProPlayer.updateMany).not.toHaveBeenCalled();
  });

  it("別 UID 登録済み → conflict_other_account（直接上書きしない）", async () => {
    resolveOk();
    const tx = fakeTx({ playerCurrent: { lineUserId: OTHER } });
    runWith(tx);
    expect(await manualLinkPlayerLineUser(linkArgs)).toEqual({ kind: "conflict_other_account" });
    expect(tx.uzuProPlayer.updateMany).not.toHaveBeenCalled();
  });

  it("同一予約内で別プレイヤーに同 UID → conflict_booking_duplicate", async () => {
    resolveOk();
    const tx = fakeTx({ playerCurrent: { lineUserId: null }, dup: { id: "p2" } });
    runWith(tx);
    expect(await manualLinkPlayerLineUser(linkArgs)).toEqual({ kind: "conflict_booking_duplicate" });
    expect(tx.uzuProPlayer.updateMany).not.toHaveBeenCalled();
  });
});

describe("manualUnlinkPlayerLineUser", () => {
  const unlinkArgs = { oaId: OA, workId: WORK, playerId: PLAYER };

  function unlinkTx(current: unknown) {
    const findFirst = vi.fn().mockResolvedValueOnce(current);
    return {
      $queryRaw: vi.fn().mockResolvedValue([{ id: BOOKING }]),
      uzuProPlayer: { findFirst, updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      uzuProLiffLink: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as Prisma.TransactionClient & {
      $queryRaw: ReturnType<typeof vi.fn>;
      uzuProPlayer: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
      uzuProLiffLink: { updateMany: ReturnType<typeof vi.fn> };
    };
  }

  it("player 未解決 → player_not_found、tx を開かない", async () => {
    mp.uzuProPlayer.findFirst.mockResolvedValueOnce(null);
    expect(await manualUnlinkPlayerLineUser(unlinkArgs)).toEqual({ kind: "player_not_found" });
    expect(mp.$transaction).not.toHaveBeenCalled();
  });

  it("連携済み → unlinked、LINE のみ解除 + linked リンクを issued へ（revoke しない）", async () => {
    resolveOk();
    const tx = unlinkTx({ lineUserId: UID });
    runWith(tx);
    expect(await manualUnlinkPlayerLineUser(unlinkArgs)).toEqual({ kind: "unlinked" });
    // player: lineUserId/linkedAt/source を null に。
    expect(tx.uzuProPlayer.updateMany.mock.calls[0][0].data).toMatchObject({ lineUserId: null, linkedAt: null, lineLinkSource: null });
    // liffLink: status linked → issued（失効/再発行はしない）。
    expect(tx.uzuProLiffLink.updateMany.mock.calls[0][0]).toMatchObject({
      where: { playerId: PLAYER, oaId: OA, status: "linked" },
      data: { status: "issued", linkedAt: null },
    });
  });

  it("未連携 → already_unlinked（冪等・更新しない）", async () => {
    resolveOk();
    const tx = unlinkTx({ lineUserId: null });
    runWith(tx);
    expect(await manualUnlinkPlayerLineUser(unlinkArgs)).toEqual({ kind: "already_unlinked" });
    expect(tx.uzuProPlayer.updateMany).not.toHaveBeenCalled();
    expect(tx.uzuProLiffLink.updateMany).not.toHaveBeenCalled();
  });
});
