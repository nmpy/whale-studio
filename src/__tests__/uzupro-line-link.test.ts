// src/__tests__/uzupro-line-link.test.ts
// for UZU Pro プレイヤー LINE 連携サービス（@/lib/uzupro/line-link）のユニット:
//   resolveUzuProPlayerLink … 公開コード→リンク解決（not_found / revoked / expired / ok）
//   bindPlayerLineUser       … 予約行ロック下での紐づけ（linked / already_linked_same / conflict_*）
// prisma は mock。bind は prisma.$transaction を fakeTx で駆動（uzupro-sync.test.ts の tx パターン踏襲）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const { mp } = vi.hoisted(() => ({
  mp: {
    uzuProLiffLink: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));

import { resolveUzuProPlayerLink, bindPlayerLineUser } from "@/lib/uzupro/line-link";

beforeEach(() => {
  vi.clearAllMocks();
});

// ───────── resolve ─────────
describe("resolveUzuProPlayerLink", () => {
  const CODE = "public-code-token-abcdef";
  // findUnique が返す link の共通形（select 済みフィールド）。
  const link = (over: Record<string, unknown> = {}) => ({
    id: "l1",
    playerId: "p1",
    oaId: "oa1",
    status: "issued",
    expiresAt: null,
    revokedAt: null,
    // 対象作品が for UZU Pro 有効（実行時利用可）の既定形。
    player: { bookingId: "b1", booking: { work: { uzuProEnabled: true } } },
    oa: { liffId: "1656565252-abcd" },
    ...over,
  });

  it("存在しない（findUnique=null）→ not_found、tokenHash で引く", async () => {
    const db = { uzuProLiffLink: { findUnique: vi.fn().mockResolvedValue(null) } };
    const r = await resolveUzuProPlayerLink(db as never, CODE);
    expect(r).toEqual({ kind: "not_found" });
    // 平文ではなく tokenHash(sha256) で検索する。
    const where = db.uzuProLiffLink.findUnique.mock.calls[0][0].where;
    expect(where.tokenHash).toEqual(expect.any(String));
    expect(where.tokenHash).not.toBe(CODE);
  });

  it("revoked（status revoked）→ revoked", async () => {
    const db = { uzuProLiffLink: { findUnique: vi.fn().mockResolvedValue(link({ status: "revoked" })) } };
    expect(await resolveUzuProPlayerLink(db as never, CODE)).toEqual({ kind: "revoked" });
  });

  it("revoked（revokedAt あり）→ revoked", async () => {
    const db = { uzuProLiffLink: { findUnique: vi.fn().mockResolvedValue(link({ revokedAt: new Date("2026-01-01T00:00:00Z") })) } };
    expect(await resolveUzuProPlayerLink(db as never, CODE)).toEqual({ kind: "revoked" });
  });

  it("生成失敗（status error）→ revoked 相当", async () => {
    const db = { uzuProLiffLink: { findUnique: vi.fn().mockResolvedValue(link({ status: "error" })) } };
    expect(await resolveUzuProPlayerLink(db as never, CODE)).toEqual({ kind: "revoked" });
  });

  it("期限切れ（expiresAt が過去）→ expired", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const db = { uzuProLiffLink: { findUnique: vi.fn().mockResolvedValue(link({ expiresAt: new Date("2026-01-01T00:00:00Z") })) } };
    expect(await resolveUzuProPlayerLink(db as never, CODE, now)).toEqual({ kind: "expired" });
  });

  it("有効（issued）→ ok（linkId/playerId/bookingId/oaId/liffId を返す）", async () => {
    const db = { uzuProLiffLink: { findUnique: vi.fn().mockResolvedValue(link()) } };
    const r = await resolveUzuProPlayerLink(db as never, CODE);
    expect(r).toEqual({
      kind: "ok",
      linkId: "l1",
      playerId: "p1",
      bookingId: "b1",
      oaId: "oa1",
      liffId: "1656565252-abcd",
    });
  });

  it("linked も利用可（ok）", async () => {
    const db = { uzuProLiffLink: { findUnique: vi.fn().mockResolvedValue(link({ status: "linked" })) } };
    expect((await resolveUzuProPlayerLink(db as never, CODE)).kind).toBe("ok");
  });

  // ── Work.uzuProEnabled による実行時利用停止（発行済み URL も無効化中は利用不可） ──
  it("作品 for UZU Pro 無効（uzuProEnabled=false）→ not_found に一般化（作品無効を露出しない）", async () => {
    const db = {
      uzuProLiffLink: {
        findUnique: vi.fn().mockResolvedValue(
          link({ player: { bookingId: "b1", booking: { work: { uzuProEnabled: false } } } }),
        ),
      },
    };
    // 有効リンク（issued・未失効・期限内）でも作品無効なら not_found。
    expect(await resolveUzuProPlayerLink(db as never, CODE)).toEqual({ kind: "not_found" });
  });

  it("作品無効は revoked/expired より優先して not_found（状態差を漏らさない）", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const db = {
      uzuProLiffLink: {
        findUnique: vi.fn().mockResolvedValue(
          link({
            status: "revoked",
            revokedAt: new Date("2026-01-01T00:00:00Z"),
            expiresAt: new Date("2026-01-01T00:00:00Z"),
            player: { bookingId: "b1", booking: { work: { uzuProEnabled: false } } },
          }),
        ),
      },
    };
    expect(await resolveUzuProPlayerLink(db as never, CODE, now)).toEqual({ kind: "not_found" });
  });

  it("関連データ欠損（booking / work relation 無し）→ not_found に一般化", async () => {
    const dbNoWork = {
      uzuProLiffLink: {
        findUnique: vi.fn().mockResolvedValue(link({ player: { bookingId: "b1", booking: { work: null } } })),
      },
    };
    expect(await resolveUzuProPlayerLink(dbNoWork as never, CODE)).toEqual({ kind: "not_found" });
    const dbNoBooking = {
      uzuProLiffLink: {
        findUnique: vi.fn().mockResolvedValue(link({ player: { bookingId: "b1", booking: null } })),
      },
    };
    expect(await resolveUzuProPlayerLink(dbNoBooking as never, CODE)).toEqual({ kind: "not_found" });
  });

  it("解決 select は player.booking.work.uzuProEnabled まで含む", async () => {
    const findUnique = vi.fn().mockResolvedValue(link());
    await resolveUzuProPlayerLink({ uzuProLiffLink: { findUnique } } as never, CODE);
    const select = findUnique.mock.calls[0][0].select;
    expect(select.player.select.booking.select.work.select.uzuProEnabled).toBe(true);
  });
});

// ───────── bind（fakeTx 直接） ─────────
describe("bindPlayerLineUser", () => {
  const UID = "U0123456789abcdef0123456789abcdef";
  const OTHER = "Uffffffffffffffffffffffffffffffff";
  const args = { linkId: "l1", playerId: "p1", bookingId: "b1", oaId: "oa1", lineUserId: UID };

  // 予約行 FOR UPDATE ロック → 作品有効の書き込み直前再検証（works FOR UPDATE）→ プレイヤー現在値
  // + 重複 + compare-and-set + link 更新を備えた fakeTx。
  function fakeTx(over: {
    playerCurrent?: unknown; // findFirst 1回目（現在のプレイヤー）
    dup?: unknown; // findFirst 2回目（同一予約内重複）
    updateCount?: number; // updateMany の count
    workEnabled?: boolean; // 書き込み直前再検証で見える works.uzu_pro_enabled（既定 true）
    bookingRow?: unknown; // uzuProBooking.findFirst の戻り（既定 { workId: "w1" }）
  } = {}) {
    const findFirst = vi.fn();
    // 1回目 = 現在プレイヤー、2回目 = 重複チェック。
    findFirst
      .mockResolvedValueOnce(over.playerCurrent === undefined ? { lineUserId: null } : over.playerCurrent)
      .mockResolvedValueOnce(over.dup === undefined ? null : over.dup);
    // $queryRaw: 1回目 = 予約行 FOR UPDATE、2回目 = works 行 FOR UPDATE（uzu_pro_enabled 取得）。
    const workEnabled = over.workEnabled ?? true;
    const queryRaw = vi.fn();
    queryRaw
      .mockResolvedValueOnce([{ id: "b1" }])
      .mockResolvedValueOnce([{ uzu_pro_enabled: workEnabled }]);
    return {
      $queryRaw: queryRaw,
      uzuProBooking: {
        findFirst: vi
          .fn()
          .mockResolvedValue(over.bookingRow === undefined ? { workId: "w1" } : over.bookingRow),
      },
      uzuProPlayer: {
        findFirst,
        updateMany: vi.fn().mockResolvedValue({ count: over.updateCount ?? 1 }),
      },
      uzuProLiffLink: {
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Prisma.TransactionClient & {
      $queryRaw: ReturnType<typeof vi.fn>;
      uzuProBooking: { findFirst: ReturnType<typeof vi.fn> };
      uzuProPlayer: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
      uzuProLiffLink: { update: ReturnType<typeof vi.fn> };
    };
  }
  function runWith(tx: ReturnType<typeof fakeTx>) {
    mp.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
  }

  it("初回 bind: 空 → linked、link を status:linked に更新、予約行を FOR UPDATE ロック", async () => {
    const tx = fakeTx({ playerCurrent: { lineUserId: null }, dup: null, updateCount: 1 });
    runWith(tx);
    const r = await bindPlayerLineUser(args);
    expect(r).toEqual({ kind: "linked" });
    // compare-and-set: lineUserId=null 条件で updateMany。
    expect(tx.uzuProPlayer.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "p1", lineUserId: null },
      data: { lineUserId: UID },
    });
    // link を linked に。
    expect(tx.uzuProLiffLink.update.mock.calls[0][0]).toMatchObject({
      where: { id: "l1" },
      data: { status: "linked" },
    });
    // 予約行ロック（uzu_pro_bookings FOR UPDATE）＋作品行ロック（works FOR UPDATE）の 2 本。
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const s0 = (tx.$queryRaw.mock.calls[0][0] as unknown as string[]).join(" ");
    expect(s0).toContain("uzu_pro_bookings");
    expect(s0).toContain("FOR UPDATE");
    const s1 = (tx.$queryRaw.mock.calls[1][0] as unknown as string[]).join(" ");
    expect(s1).toContain("works");
    expect(s1).toContain("uzu_pro_enabled");
    expect(s1).toContain("FOR UPDATE");
  });

  it("書き込み直前再検証で作品無効（workEnabled=false）→ work_disabled、一切更新しない", async () => {
    const tx = fakeTx({ playerCurrent: { lineUserId: null }, workEnabled: false });
    runWith(tx);
    const r = await bindPlayerLineUser(args);
    expect(r).toEqual({ kind: "work_disabled" });
    // lineUserId / linkedAt / link status を変更しない。
    expect(tx.uzuProPlayer.updateMany).not.toHaveBeenCalled();
    expect(tx.uzuProLiffLink.update).not.toHaveBeenCalled();
    // 現在プレイヤーの読み取りまで進まない（作品無効で早期停止）。
    expect(tx.uzuProPlayer.findFirst).not.toHaveBeenCalled();
  });

  it("再検証で予約→作品 relation 欠損（bookingRow=null）→ work_disabled、更新しない", async () => {
    const tx = fakeTx({ bookingRow: null });
    runWith(tx);
    expect(await bindPlayerLineUser(args)).toEqual({ kind: "work_disabled" });
    expect(tx.uzuProPlayer.updateMany).not.toHaveBeenCalled();
    expect(tx.uzuProLiffLink.update).not.toHaveBeenCalled();
  });

  it("冪等（同一 UID が既に紐づく）→ already_linked_same、compare-and-set を上書きしない", async () => {
    const tx = fakeTx({ playerCurrent: { lineUserId: UID } });
    runWith(tx);
    const r = await bindPlayerLineUser(args);
    expect(r).toEqual({ kind: "already_linked_same" });
    // 後勝ち上書きしない = updateMany を呼ばない。
    expect(tx.uzuProPlayer.updateMany).not.toHaveBeenCalled();
    // link は linked（冪等でも状態は確定させる）。
    expect(tx.uzuProLiffLink.update.mock.calls[0][0]).toMatchObject({ data: { status: "linked" } });
  });

  it("別アカウント紐づけ済み → conflict_other_account、一切更新しない", async () => {
    const tx = fakeTx({ playerCurrent: { lineUserId: OTHER } });
    runWith(tx);
    const r = await bindPlayerLineUser(args);
    expect(r).toEqual({ kind: "conflict_other_account" });
    expect(tx.uzuProPlayer.updateMany).not.toHaveBeenCalled();
    expect(tx.uzuProLiffLink.update).not.toHaveBeenCalled();
  });

  it("同一予約内で別プレイヤーに同 UID → conflict_booking_duplicate", async () => {
    const tx = fakeTx({ playerCurrent: { lineUserId: null }, dup: { id: "p2" } });
    runWith(tx);
    const r = await bindPlayerLineUser(args);
    expect(r).toEqual({ kind: "conflict_booking_duplicate" });
    expect(tx.uzuProPlayer.updateMany).not.toHaveBeenCalled();
    expect(tx.uzuProLiffLink.update).not.toHaveBeenCalled();
    // 重複チェックは (bookingId, lineUserId, id != playerId)。
    expect(tx.uzuProPlayer.findFirst.mock.calls[1][0].where).toMatchObject({
      bookingId: "b1",
      lineUserId: UID,
      id: { not: "p1" },
    });
  });

  it("解決済みだがプレイヤー不在（テナント越境等）→ conflict_other_account", async () => {
    const tx = fakeTx({ playerCurrent: null });
    runWith(tx);
    expect(await bindPlayerLineUser(args)).toEqual({ kind: "conflict_other_account" });
    expect(tx.uzuProLiffLink.update).not.toHaveBeenCalled();
  });
});
