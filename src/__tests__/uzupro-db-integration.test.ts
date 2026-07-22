// src/__tests__/uzupro-db-integration.test.ts
// for ウズプロ: 実 PostgreSQL に対する統合テスト（LIFF 並行発行の直列化 / 部分UNIQUE / 同期人数変更 / 越境不可）。
//
// 通常の CI/`vitest run` では **skip**（DB 不要）。実 DB 検証時のみ:
//   UZUPRO_DB_TEST=1 DATABASE_URL=postgresql://...@127.0.0.1:PORT/postgres npx vitest run src/__tests__/uzupro-db-integration.test.ts
// ※ localhost の使い捨て test DB のみで実行すること（本番/共有 DB では実行しない）。
//
// この統合テストは #591 の team/capacity 版とは独立に、プレイヤー単位 LIFF の並行安全性を実 DB で検証する。

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { issueLiffForPlayer } from "@/lib/uzupro/liff";
import { syncUzuProBooking } from "@/lib/uzupro/sync";

const RUN = process.env.UZUPRO_DB_TEST === "1";
const prisma = new PrismaClient();

describe.skipIf(!RUN)("uzupro live-DB integration", () => {
  let oaId = "";
  let workId = "";
  let sessionId = "";

  beforeAll(async () => {
    // 決定性のため uzu_pro 系テーブルをクリア（使い捨て localhost test DB のみ）。
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "uzu_pro_liff_links","uzu_pro_players","uzu_pro_bookings","uzu_pro_sync_requests","uzu_pro_activity_logs","uzu_pro_grants" CASCADE`,
    );
    const oa = await prisma.oa.create({
      data: { title: "itest", channelId: "c", channelSecret: "s", channelAccessToken: "a" },
    });
    oaId = oa.id;
    const work = await prisma.work.create({ data: { oaId, title: "w" } });
    workId = work.id;
    const s = await prisma.liveSession.create({
      data: { oaId, workId, name: "sess", origin: "UZU_PRO", externalSessionRef: "ext-s-itest", startsAt: new Date("2026-08-01T10:00:00Z") },
    });
    sessionId = s.id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  async function mkBooking(ext: string, count: number, indexes: number[]) {
    const b = await prisma.uzuProBooking.create({
      data: { oaId, workId, liveSessionId: sessionId, externalBookingId: ext, participantCount: count, sourceUpdatedAt: new Date(), syncedAt: new Date() },
    });
    const players = [];
    for (const i of indexes) players.push(await prisma.uzuProPlayer.create({ data: { oaId, bookingId: b.id, playerIndex: i } }));
    return { bookingId: b.id, players };
  }
  const issued = (pid: string) => prisma.uzuProLiffLink.count({ where: { playerId: pid, status: "issued" } });
  const activeCount = (ext: string) => prisma.uzuProPlayer.count({ where: { booking: { externalBookingId: ext }, status: "active" } });
  const cancelledCount = (ext: string) => prisma.uzuProPlayer.count({ where: { booking: { externalBookingId: ext }, status: "cancelled" } });
  const issuedLinksForBooking = (ext: string) =>
    prisma.uzuProLiffLink.count({ where: { player: { booking: { externalBookingId: ext } }, status: "issued" } });

  // ── 部分 UNIQUE INDEX の実 DB 挙動 ──────────────────────────────
  it("partial unique: 1 issued/player, multiple revoked ok, other player issued ok", async () => {
    const { players } = await mkBooking("pi-1", 2, [1, 2]);
    const [p1, p2] = players.map((p) => p.id);
    await prisma.uzuProLiffLink.create({ data: { oaId, playerId: p1, tokenHash: "h1", status: "issued" } });
    await expect(
      prisma.uzuProLiffLink.create({ data: { oaId, playerId: p1, tokenHash: "h2", status: "issued" } }),
    ).rejects.toThrow(); // partial-unique violation (P2002)
    await prisma.uzuProLiffLink.create({ data: { oaId, playerId: p1, tokenHash: "h3", status: "revoked" } });
    await prisma.uzuProLiffLink.create({ data: { oaId, playerId: p1, tokenHash: "h4", status: "revoked" } });
    await prisma.uzuProLiffLink.create({ data: { oaId, playerId: p2, tokenHash: "h5", status: "issued" } });
    expect(await issued(p1)).toBe(1);
    expect(await issued(p2)).toBe(1);
  });

  // ── 並行発行の直列化（行ロック）──────────────────────────────
  it("10x concurrent issue (same player) -> exactly 1 issued, no rejects, 1 real insert", async () => {
    const { players } = await mkBooking("pi-2", 1, [1]);
    const pid = players[0].id;
    const res = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        prisma.$transaction((tx) => issueLiffForPlayer(tx, { oaId, playerId: pid, liffId: "L", expiresAt: null, now: new Date() })),
      ),
    );
    expect(res.filter((r) => r.status === "rejected")).toHaveLength(0);
    expect(await issued(pid)).toBe(1);
    const created = res.filter((r) => r.status === "fulfilled" && (r.value as { kind: string }).kind === "issued").length;
    expect(created).toBe(1);
  });

  it("5x concurrent reissue -> exactly 1 issued at end, no rejects", async () => {
    const { players } = await mkBooking("pi-3", 1, [1]);
    const pid = players[0].id;
    await prisma.$transaction((tx) => issueLiffForPlayer(tx, { oaId, playerId: pid, liffId: "L", expiresAt: null, now: new Date() }));
    const res = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        prisma.$transaction((tx) => issueLiffForPlayer(tx, { oaId, playerId: pid, liffId: "L", expiresAt: null, now: new Date(), reissue: true })),
      ),
    );
    expect(res.filter((r) => r.status === "rejected")).toHaveLength(0);
    expect(await issued(pid)).toBe(1);
  });

  it("individual + 2 bulk-like passes concurrent over overlapping players -> each 1 issued", async () => {
    const { players } = await mkBooking("pi-4", 3, [1, 2, 3]);
    const ids = players.map((p) => p.id);
    const ops = [
      prisma.$transaction((tx) => issueLiffForPlayer(tx, { oaId, playerId: ids[0], liffId: "L", expiresAt: null, now: new Date() })),
      ...ids.map((id) => prisma.$transaction((tx) => issueLiffForPlayer(tx, { oaId, playerId: id, liffId: "L", expiresAt: null, now: new Date() }))),
      ...ids.map((id) => prisma.$transaction((tx) => issueLiffForPlayer(tx, { oaId, playerId: id, liffId: "L", expiresAt: null, now: new Date() }))),
    ];
    const res = await Promise.allSettled(ops);
    expect(res.filter((r) => r.status === "rejected")).toHaveLength(0);
    for (const id of ids) expect(await issued(id)).toBe(1);
  });

  it("cross-OA isolation: issue with wrong oaId -> not_found, no insert", async () => {
    const { players } = await mkBooking("pi-5", 1, [1]);
    const pid = players[0].id;
    const r = await prisma.$transaction((tx) => issueLiffForPlayer(tx, { oaId: "other-oa", playerId: pid, liffId: "L", expiresAt: null, now: new Date() }));
    expect(r.kind).toBe("not_found");
    expect(await prisma.uzuProLiffLink.count({ where: { playerId: pid } })).toBe(0);
  });

  // ── 同期: 人数増減 / キャンセル / 巻き戻り防止 ─────────────────
  it("headcount 1->4->2->6->1 with cancel/revive (no physical delete)", async () => {
    const ext = "sync-hc";
    const base = { oaId, workId, externalSessionRef: "ext-s-itest", sessionStartsAt: null, sessionEndsAt: null, externalBookingId: ext, bookingStatus: "confirmed" as const };
    const mk = (count: number, t: string) => ({ ...base, participantCount: count, sourceUpdatedAt: new Date(t), players: Array.from({ length: count }, (_, i) => ({ playerIndex: i + 1 })), now: new Date() });
    await prisma.$transaction((tx) => syncUzuProBooking(tx, mk(1, "2026-01-01T00:00:00Z")));
    expect(await activeCount(ext)).toBe(1);
    await prisma.$transaction((tx) => syncUzuProBooking(tx, mk(4, "2026-01-02T00:00:00Z")));
    expect(await activeCount(ext)).toBe(4);
    await prisma.$transaction((tx) => syncUzuProBooking(tx, mk(2, "2026-01-03T00:00:00Z")));
    expect(await activeCount(ext)).toBe(2);
    expect(await cancelledCount(ext)).toBe(2);
    await prisma.$transaction((tx) => syncUzuProBooking(tx, mk(6, "2026-01-04T00:00:00Z")));
    expect(await activeCount(ext)).toBe(6); // revive 3,4 + add 5,6
    await prisma.$transaction((tx) => syncUzuProBooking(tx, mk(1, "2026-01-05T00:00:00Z")));
    expect(await activeCount(ext)).toBe(1);
    // 物理削除していない: 総行数は最大到達人数(6)を保持
    const total = await prisma.uzuProPlayer.count({ where: { booking: { externalBookingId: ext } } });
    expect(total).toBe(6);
  });

  it("stale sourceUpdatedAt does not roll back state", async () => {
    const ext = "sync-stale";
    const base = { oaId, workId, externalSessionRef: "ext-s-itest", sessionStartsAt: null, sessionEndsAt: null, externalBookingId: ext, bookingStatus: "confirmed" as const };
    await prisma.$transaction((tx) => syncUzuProBooking(tx, { ...base, participantCount: 4, sourceUpdatedAt: new Date("2026-02-02T00:00:00Z"), players: [1, 2, 3, 4].map((i) => ({ playerIndex: i })), now: new Date() }));
    const r = await prisma.$transaction((tx) => syncUzuProBooking(tx, { ...base, participantCount: 1, sourceUpdatedAt: new Date("2026-02-01T00:00:00Z"), players: [{ playerIndex: 1 }], now: new Date() }));
    expect(r.applied).toBe(false);
    expect(await activeCount(ext)).toBe(4);
  });

  it("booking cancel -> all players cancelled AND their issued LIFF revoked", async () => {
    const ext = "sync-cancel";
    const base = { oaId, workId, externalSessionRef: "ext-s-itest", sessionStartsAt: null, sessionEndsAt: null, externalBookingId: ext };
    await prisma.$transaction((tx) => syncUzuProBooking(tx, { ...base, bookingStatus: "confirmed", participantCount: 2, sourceUpdatedAt: new Date("2026-03-01T00:00:00Z"), players: [1, 2].map((i) => ({ playerIndex: i })), now: new Date() }));
    const players = await prisma.uzuProPlayer.findMany({ where: { booking: { externalBookingId: ext } } });
    for (const p of players) await prisma.$transaction((tx) => issueLiffForPlayer(tx, { oaId, playerId: p.id, liffId: "L", expiresAt: null, now: new Date() }));
    expect(await issuedLinksForBooking(ext)).toBe(2);
    await prisma.$transaction((tx) => syncUzuProBooking(tx, { ...base, bookingStatus: "cancelled", participantCount: 2, sourceUpdatedAt: new Date("2026-03-02T00:00:00Z"), players: [1, 2].map((i) => ({ playerIndex: i })), now: new Date() }));
    expect(await activeCount(ext)).toBe(0);
    expect(await issuedLinksForBooking(ext)).toBe(0); // 減員/キャンセルされたプレイヤーの LIFF は利用不可(revoked)に
  });

  it("headcount decrease revokes LIFF of removed players (straggler cancel)", async () => {
    const ext = "sync-shrink";
    const base = { oaId, workId, externalSessionRef: "ext-s-itest", sessionStartsAt: null, sessionEndsAt: null, externalBookingId: ext, bookingStatus: "confirmed" as const };
    await prisma.$transaction((tx) => syncUzuProBooking(tx, { ...base, participantCount: 2, sourceUpdatedAt: new Date("2026-04-01T00:00:00Z"), players: [1, 2].map((i) => ({ playerIndex: i })), now: new Date() }));
    const players = await prisma.uzuProPlayer.findMany({ where: { booking: { externalBookingId: ext } } });
    for (const p of players) await prisma.$transaction((tx) => issueLiffForPlayer(tx, { oaId, playerId: p.id, liffId: "L", expiresAt: null, now: new Date() }));
    expect(await issuedLinksForBooking(ext)).toBe(2);
    // 2 -> 1 名: player 2 が減員 → その issued LIFF は失効
    await prisma.$transaction((tx) => syncUzuProBooking(tx, { ...base, participantCount: 1, sourceUpdatedAt: new Date("2026-04-02T00:00:00Z"), players: [{ playerIndex: 1 }], now: new Date() }));
    expect(await activeCount(ext)).toBe(1);
    expect(await issuedLinksForBooking(ext)).toBe(1); // player1 の分のみ残る
  });
});
