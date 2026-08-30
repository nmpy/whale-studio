// src/__tests__/uzupro-line-link-db.test.ts
// for UZU Pro プレイヤー LINE 連携の実 PostgreSQL 統合テスト（並行安全性・予約内一意・越境）。
//
// 通常の CI/`vitest run` では **skip**（DB 不要）。実 DB 検証時のみ:
//   UZUPRO_DB_TEST=1 DATABASE_URL=postgresql://...@127.0.0.1:PORT/postgres npx vitest run src/__tests__/uzupro-line-link-db.test.ts
// ※ localhost の使い捨て test DB のみで実行すること（本番/共有 DB では実行しない）。
//
// 検証観点:
//   - 初回 bind で lineUserId + linkedAt を保存（人数可変 1/2/4/6）。
//   - 同一 UID 再送は冪等（値は 1 つ）。別 UID は元を保持（後勝ちしない）。
//   - 同一予約内での UID 重複は拒否。別予約なら同一 UID を許可。
//   - 並行: 同一プレイヤーへ異なる 10 UID → ちょうど 1 件 linked、他は conflict_other_account、最終値は勝者。
//   - 並行: 同一予約の別プレイヤー 2 枠へ同一 UID → ちょうど 1 件 linked、他は conflict_booking_duplicate。

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bindPlayerLineUser, resolveUzuProPlayerLink } from "@/lib/uzupro/line-link";
import { generateTicketToken, hashTicketToken } from "@/lib/live-ticket-link";

const RUN = process.env.UZUPRO_DB_TEST === "1";
const prisma = new PrismaClient();

describe.skipIf(!RUN)("uzupro line-link live-DB integration", () => {
  let oaId = "";
  let workId = "";
  let sessionId = "";

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "uzu_pro_liff_links","uzu_pro_players","uzu_pro_bookings","uzu_pro_sync_requests","uzu_pro_activity_logs","uzu_pro_grants" CASCADE`,
    );
    const oa = await prisma.oa.create({
      data: { title: "itest-link", channelId: "c", channelSecret: "s", channelAccessToken: "a", liffId: "1656565252-abcd" },
    });
    oaId = oa.id;
    // 既定の作品は for UZU Pro 有効（多くのケースが「有効前提」の並行/一意検証）。
    const work = await prisma.work.create({ data: { oaId, title: "w", uzuProEnabled: true } });
    workId = work.id;
    const s = await prisma.liveSession.create({
      data: { oaId, workId, name: "sess", origin: "UZU_PRO", externalSessionRef: "ext-s-link", startsAt: new Date("2026-08-01T10:00:00Z") },
    });
    sessionId = s.id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  type PlayerFixture = { playerId: string; linkId: string; publicCode: string; bookingId: string };

  // 予約 + N プレイヤー + 各プレイヤーに issued LIFF リンク（既知 tokenHash）を作成。
  async function mkBooking(ext: string, count: number): Promise<{ bookingId: string; players: PlayerFixture[] }> {
    const b = await prisma.uzuProBooking.create({
      data: { oaId, workId, liveSessionId: sessionId, externalBookingId: ext, participantCount: count, sourceUpdatedAt: new Date(), syncedAt: new Date() },
    });
    const players: PlayerFixture[] = [];
    for (let i = 1; i <= count; i++) {
      const p = await prisma.uzuProPlayer.create({ data: { oaId, bookingId: b.id, playerIndex: i } });
      const publicCode = generateTicketToken();
      const link = await prisma.uzuProLiffLink.create({
        data: { oaId, playerId: p.id, tokenHash: hashTicketToken(publicCode), status: "issued" },
      });
      players.push({ playerId: p.id, linkId: link.id, publicCode, bookingId: b.id });
    }
    return { bookingId: b.id, players };
  }
  const bind = (p: PlayerFixture, uid: string) =>
    bindPlayerLineUser({ linkId: p.linkId, playerId: p.playerId, bookingId: p.bookingId, oaId, lineUserId: uid });
  const uid = (label: string) => `U${label}`.padEnd(33, "0");
  const playerRow = (id: string) => prisma.uzuProPlayer.findUnique({ where: { id }, select: { lineUserId: true, linkedAt: true } });

  it("初回 bind で lineUserId+linkedAt を保存（人数可変 1/2/4/6）", async () => {
    for (const n of [1, 2, 4, 6]) {
      const { players } = await mkBooking(`count-${n}`, n);
      const p = players[0];
      const u = uid(`c${n}`);
      const r = await bind(p, u);
      expect(r.kind).toBe("linked");
      const row = await playerRow(p.playerId);
      expect(row?.lineUserId).toBe(u);
      expect(row?.linkedAt).not.toBeNull();
      // リンクは resolve で ok（status=linked も利用可）。
      const resolved = await resolveUzuProPlayerLink(prisma, p.publicCode);
      expect(resolved.kind).toBe("ok");
    }
  });

  it("同一 UID 再送は冪等 → still linked、値は 1 つ", async () => {
    const { players } = await mkBooking("idem", 1);
    const p = players[0];
    const u = uid("idem");
    expect((await bind(p, u)).kind).toBe("linked");
    expect((await bind(p, u)).kind).toBe("already_linked_same");
    const row = await playerRow(p.playerId);
    expect(row?.lineUserId).toBe(u);
  });

  it("同一プレイヤー + 別 UID → conflict、元の値を保持（後勝ちしない）", async () => {
    const { players } = await mkBooking("conflict", 1);
    const p = players[0];
    const first = uid("first");
    expect((await bind(p, first)).kind).toBe("linked");
    const r = await bind(p, uid("second"));
    expect(r.kind).toBe("conflict_other_account");
    expect((await playerRow(p.playerId))?.lineUserId).toBe(first);
  });

  it("同一予約内での UID 重複 → 拒否（別プレイヤーに同 UID）", async () => {
    const { players } = await mkBooking("dup-booking", 2);
    const [p1, p2] = players;
    const u = uid("dup");
    expect((await bind(p1, u)).kind).toBe("linked");
    expect((await bind(p2, u)).kind).toBe("conflict_booking_duplicate");
    expect((await playerRow(p2.playerId))?.lineUserId).toBeNull();
  });

  it("別予約なら同一 UID を許可", async () => {
    const a = await mkBooking("multi-a", 1);
    const b = await mkBooking("multi-b", 1);
    const u = uid("cross");
    expect((await bind(a.players[0], u)).kind).toBe("linked");
    expect((await bind(b.players[0], u)).kind).toBe("linked");
  });

  it("並行: 同一プレイヤーへ異なる 10 UID → ちょうど 1 linked、他 conflict_other_account、最終値は勝者", async () => {
    const { players } = await mkBooking("conc-10", 1);
    const p = players[0];
    const uids = Array.from({ length: 10 }, (_, i) => uid(`race${i}`));
    const res = await Promise.allSettled(uids.map((u) => bind(p, u)));
    expect(res.filter((r) => r.status === "rejected")).toHaveLength(0);
    const kinds = res.map((r) => (r.status === "fulfilled" ? r.value.kind : "rejected"));
    expect(kinds.filter((k) => k === "linked")).toHaveLength(1);
    expect(kinds.filter((k) => k === "conflict_other_account")).toHaveLength(9);
    const wonIdx = kinds.indexOf("linked");
    expect((await playerRow(p.playerId))?.lineUserId).toBe(uids[wonIdx]);
  });

  it("並行: 同一予約の別プレイヤー 2 枠へ同一 UID → ちょうど 1 linked、他 conflict_booking_duplicate", async () => {
    const { players } = await mkBooking("conc-dup", 2);
    const [p1, p2] = players;
    const u = uid("shared");
    const res = await Promise.allSettled([bind(p1, u), bind(p2, u)]);
    expect(res.filter((r) => r.status === "rejected")).toHaveLength(0);
    const kinds = res.map((r) => (r.status === "fulfilled" ? r.value.kind : "rejected"));
    expect(kinds.filter((k) => k === "linked")).toHaveLength(1);
    expect(kinds.filter((k) => k === "conflict_booking_duplicate")).toHaveLength(1);
    // 予約内で当該 UID を持つプレイヤーはちょうど 1 名。
    const holders = await prisma.uzuProPlayer.count({ where: { bookingId: p1.bookingId, lineUserId: u } });
    expect(holders).toBe(1);
  });

  it("resolve: 未知コードは not_found", async () => {
    const r = await resolveUzuProPlayerLink(prisma, generateTicketToken());
    expect(r.kind).toBe("not_found");
  });

  // ─────────────── Work.uzuProEnabled による実行時利用停止（PR #595 追従） ───────────────
  const setWorkEnabled = (enabled: boolean) =>
    prisma.work.update({ where: { id: workId }, data: { uzuProEnabled: enabled } });

  describe("Work.uzuProEnabled 実行時判定", () => {
    afterAll(async () => {
      // 後続に影響しないよう有効へ戻す。
      await setWorkEnabled(true);
    });

    it("有効＋有効リンク → resolve ok（利用可能）", async () => {
      const { players } = await mkBooking("we-enabled", 1);
      await setWorkEnabled(true);
      expect((await resolveUzuProPlayerLink(prisma, players[0].publicCode)).kind).toBe("ok");
    });

    it("無効 → resolve not_found（発行済みリンクも実行時利用停止・DB は失効させない）", async () => {
      const { players } = await mkBooking("we-disabled", 1);
      const p = players[0];
      await setWorkEnabled(false);
      expect((await resolveUzuProPlayerLink(prisma, p.publicCode)).kind).toBe("not_found");
      // リンクの DB 状態は失効させない（status=issued / revokedAt=null のまま）。
      const link = await prisma.uzuProLiffLink.findUnique({
        where: { id: p.linkId }, select: { status: true, revokedAt: true },
      });
      expect(link?.status).toBe("issued");
      expect(link?.revokedAt).toBeNull();
    });

    it("無効中の bind → work_disabled、lineUserId/linkedAt/status を変更しない", async () => {
      const { players } = await mkBooking("we-bind-disabled", 1);
      const p = players[0];
      await setWorkEnabled(false);
      const r = await bind(p, uid("wd"));
      expect(r.kind).toBe("work_disabled");
      const row = await playerRow(p.playerId);
      expect(row?.lineUserId).toBeNull();
      expect(row?.linkedAt).toBeNull();
      const link = await prisma.uzuProLiffLink.findUnique({
        where: { id: p.linkId }, select: { status: true, linkedAt: true },
      });
      expect(link?.status).toBe("issued");
      expect(link?.linkedAt).toBeNull();
    });

    it("GET で有効→ その後無効化→ bind（書き込み直前再検証）→ work_disabled で保存しない", async () => {
      const { players } = await mkBooking("we-toctou", 1);
      const p = players[0];
      await setWorkEnabled(true);
      // 1) LIFF ページ相当（GET/resolve）では有効。
      expect((await resolveUzuProPlayerLink(prisma, p.publicCode)).kind).toBe("ok");
      // 2) 管理者が作品を無効化。
      await setWorkEnabled(false);
      // 3) 古い画面から bind 送信 → 書き込み直前の再検証で停止。
      expect((await bind(p, uid("toctou"))).kind).toBe("work_disabled");
      expect((await playerRow(p.playerId))?.lineUserId).toBeNull();
    });

    it("再有効化 → 期限内・未失効リンクは再び利用可能・bind 成功", async () => {
      const { players } = await mkBooking("we-reenable", 1);
      const p = players[0];
      await setWorkEnabled(false);
      expect((await resolveUzuProPlayerLink(prisma, p.publicCode)).kind).toBe("not_found");
      await setWorkEnabled(true);
      expect((await resolveUzuProPlayerLink(prisma, p.publicCode)).kind).toBe("ok");
      expect((await bind(p, uid("reen"))).kind).toBe("linked");
      expect((await playerRow(p.playerId))?.lineUserId).toBe(uid("reen"));
    });

    it("revoked は Work 有効でも利用不可（revoked が返る）", async () => {
      const { players } = await mkBooking("we-revoked", 1);
      const p = players[0];
      await setWorkEnabled(true);
      await prisma.uzuProLiffLink.update({ where: { id: p.linkId }, data: { revokedAt: new Date(), status: "revoked" } });
      expect((await resolveUzuProPlayerLink(prisma, p.publicCode)).kind).toBe("revoked");
    });

    it("期限切れは Work 有効でも利用不可（expired が返る）", async () => {
      const { players } = await mkBooking("we-expired", 1);
      const p = players[0];
      await setWorkEnabled(true);
      await prisma.uzuProLiffLink.update({ where: { id: p.linkId }, data: { expiresAt: new Date("2000-01-01T00:00:00Z") } });
      expect((await resolveUzuProPlayerLink(prisma, p.publicCode)).kind).toBe("expired");
    });
  });
});
