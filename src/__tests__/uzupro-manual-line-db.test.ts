// src/__tests__/uzupro-manual-line-db.test.ts
// LINE User ID 手動登録/解除の実 PostgreSQL 統合テスト（整合性・並行・TOCTOU・連携元・再連携）。
//
// 通常の CI/`vitest run` では skip。実 DB 検証時のみ:
//   UZUPRO_DB_TEST=1 DATABASE_URL=postgresql://...@127.0.0.1:PORT/postgres npx vitest run src/__tests__/uzupro-manual-line-db.test.ts
// ※ localhost の使い捨て test DB のみで実行すること。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  manualLinkPlayerLineUser,
  manualUnlinkPlayerLineUser,
  bindPlayerLineUser,
} from "@/lib/uzupro/line-link";
import { generateTicketToken, hashTicketToken } from "@/lib/live-ticket-link";

const RUN = process.env.UZUPRO_DB_TEST === "1";
const prisma = new PrismaClient();

describe.skipIf(!RUN)("uzupro manual line-link live-DB integration", () => {
  let oaId = "";
  let workId = "";
  let sessionId = "";

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "uzu_pro_liff_links","uzu_pro_players","uzu_pro_bookings","uzu_pro_sync_requests","uzu_pro_activity_logs","uzu_pro_grants" CASCADE`,
    );
    const oa = await prisma.oa.create({
      data: { title: "itest-manual", channelId: "c", channelSecret: "s", channelAccessToken: "a", liffId: "1656565252-abcd" },
    });
    oaId = oa.id;
    const work = await prisma.work.create({ data: { oaId, title: "w", uzuProEnabled: true } });
    workId = work.id;
    const s = await prisma.liveSession.create({
      data: { oaId, workId, name: "sess", origin: "UZU_PRO", externalSessionRef: "ext-s-manual", startsAt: new Date("2026-08-01T10:00:00Z") },
    });
    sessionId = s.id;
  });
  afterAll(async () => {
    await prisma.work.update({ where: { id: workId }, data: { uzuProEnabled: true } });
    await prisma.$disconnect();
  });

  type PF = { playerId: string; linkId: string; publicCode: string; bookingId: string };
  async function mkBooking(ext: string, count: number): Promise<PF[]> {
    const b = await prisma.uzuProBooking.create({
      data: { oaId, workId, liveSessionId: sessionId, externalBookingId: ext, participantCount: count, sourceUpdatedAt: new Date(), syncedAt: new Date() },
    });
    const out: PF[] = [];
    for (let i = 1; i <= count; i++) {
      const p = await prisma.uzuProPlayer.create({ data: { oaId, bookingId: b.id, playerIndex: i } });
      const publicCode = generateTicketToken();
      const link = await prisma.uzuProLiffLink.create({ data: { oaId, playerId: p.id, tokenHash: hashTicketToken(publicCode), status: "issued" } });
      out.push({ playerId: p.id, linkId: link.id, publicCode, bookingId: b.id });
    }
    return out;
  }
  const mlink = (p: PF, uid: string) => manualLinkPlayerLineUser({ oaId, workId, playerId: p.playerId, lineUserId: uid });
  const munlink = (p: PF) => manualUnlinkPlayerLineUser({ oaId, workId, playerId: p.playerId });
  const uid = (label: string) => `U${label}`.padEnd(33, "0");
  const row = (id: string) => prisma.uzuProPlayer.findUnique({ where: { id }, select: { lineUserId: true, linkedAt: true, lineLinkSource: true } });
  const setWork = (enabled: boolean) => prisma.work.update({ where: { id: workId }, data: { uzuProEnabled: enabled } });

  it("正常登録 → linked、lineUserId+linkedAt 保存、source=MANUAL", async () => {
    const [p] = await mkBooking("m-ok", 1);
    expect((await mlink(p, uid("mok"))).kind).toBe("linked");
    const r = await row(p.playerId);
    expect(r?.lineUserId).toBe(uid("mok"));
    expect(r?.linkedAt).not.toBeNull();
    expect(r?.lineLinkSource).toBe("MANUAL");
  });

  it("同一 UID 再登録は冪等成功（already_linked_same）", async () => {
    const [p] = await mkBooking("m-idem", 1);
    expect((await mlink(p, uid("mi"))).kind).toBe("linked");
    expect((await mlink(p, uid("mi"))).kind).toBe("already_linked_same");
    expect((await row(p.playerId))?.lineUserId).toBe(uid("mi"));
  });

  it("別 UID 登録済みは競合（直接上書きしない）", async () => {
    const [p] = await mkBooking("m-conf", 1);
    expect((await mlink(p, uid("first"))).kind).toBe("linked");
    expect((await mlink(p, uid("second"))).kind).toBe("conflict_other_account");
    expect((await row(p.playerId))?.lineUserId).toBe(uid("first"));
  });

  it("同一予約内別プレイヤー重複は競合", async () => {
    const [p1, p2] = await mkBooking("m-dup", 2);
    expect((await mlink(p1, uid("dup"))).kind).toBe("linked");
    expect((await mlink(p2, uid("dup"))).kind).toBe("conflict_booking_duplicate");
    expect((await row(p2.playerId))?.lineUserId).toBeNull();
  });

  it("Work 無効時は work_disabled、lineUserId/linkedAt/source 不変", async () => {
    const [p] = await mkBooking("m-disabled", 1);
    await setWork(false);
    expect((await mlink(p, uid("wd"))).kind).toBe("work_disabled");
    const r = await row(p.playerId);
    expect(r?.lineUserId).toBeNull();
    expect(r?.linkedAt).toBeNull();
    expect(r?.lineLinkSource).toBeNull();
    await setWork(true);
  });

  it("解決時有効→ 直後に無効化→ 登録は work_disabled（TOCTOU 再検証で保存しない）", async () => {
    const [p] = await mkBooking("m-toctou", 1);
    await setWork(true);
    await setWork(false); // 送信直前に無効化された状況
    expect((await mlink(p, uid("toc"))).kind).toBe("work_disabled");
    expect((await row(p.playerId))?.lineUserId).toBeNull();
    await setWork(true);
  });

  it("別作品/別OAは player_not_found（越境拒否）", async () => {
    const [p] = await mkBooking("m-cross", 1);
    const other = await prisma.work.create({ data: { oaId, title: "w2", uzuProEnabled: true } });
    const r = await manualLinkPlayerLineUser({ oaId, workId: other.id, playerId: p.playerId, lineUserId: uid("cx") });
    expect(r.kind).toBe("player_not_found");
  });

  it("手動解除 → LINE のみ解除、再登録可能", async () => {
    const [p] = await mkBooking("m-unlink", 1);
    expect((await mlink(p, uid("ul"))).kind).toBe("linked");
    expect((await munlink(p)).kind).toBe("unlinked");
    const r = await row(p.playerId);
    expect(r?.lineUserId).toBeNull();
    expect(r?.linkedAt).toBeNull();
    expect(r?.lineLinkSource).toBeNull();
    // 解除後に再登録可能。
    expect((await mlink(p, uid("ul2"))).kind).toBe("linked");
    expect((await row(p.playerId))?.lineUserId).toBe(uid("ul2"));
  });

  it("未連携の解除は冪等（already_unlinked）", async () => {
    const [p] = await mkBooking("m-unlink-empty", 1);
    expect((await munlink(p)).kind).toBe("already_unlinked");
  });

  it("LIFF 連携済みプレイヤーの手動解除は linked リンクを issued へ戻す（URL 失効しない）", async () => {
    const [p] = await mkBooking("m-liff-unlink", 1);
    // LIFF 経由で bind（source=LIFF, link status=linked）。
    expect((await bindPlayerLineUser({ linkId: p.linkId, playerId: p.playerId, bookingId: p.bookingId, oaId, lineUserId: uid("lf") })).kind).toBe("linked");
    expect((await row(p.playerId))?.lineLinkSource).toBe("LIFF");
    expect((await munlink(p)).kind).toBe("unlinked");
    // player の LINE 解除。
    expect((await row(p.playerId))?.lineUserId).toBeNull();
    // link は revoke されず issued へ（URL・tokenHash は不変 = 再利用可能）。
    const link = await prisma.uzuProLiffLink.findUnique({ where: { id: p.linkId }, select: { status: true, revokedAt: true, tokenHash: true } });
    expect(link?.status).toBe("issued");
    expect(link?.revokedAt).toBeNull();
    expect(link?.tokenHash).toBe(hashTicketToken(p.publicCode));
  });

  it("並行: 同一プレイヤーへ異なる 10 UID → ちょうど 1 linked、他 conflict_other_account", async () => {
    const [p] = await mkBooking("m-race", 1);
    const uids = Array.from({ length: 10 }, (_, i) => uid(`mr${i}`));
    const res = await Promise.allSettled(uids.map((u) => mlink(p, u)));
    expect(res.filter((r) => r.status === "rejected")).toHaveLength(0);
    const kinds = res.map((r) => (r.status === "fulfilled" ? r.value.kind : "rejected"));
    expect(kinds.filter((k) => k === "linked")).toHaveLength(1);
    expect(kinds.filter((k) => k === "conflict_other_account")).toHaveLength(9);
    const won = uids[kinds.indexOf("linked")];
    expect((await row(p.playerId))?.lineUserId).toBe(won);
  });
});
