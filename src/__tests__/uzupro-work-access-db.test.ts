// src/__tests__/uzupro-work-access-db.test.ts
// for ウズプロ: 作品単位アクセス（3 条件の AND）を実 PostgreSQL で検証する統合テスト。
//   条件 = Work.uzuProEnabled AND UzuProGrant AND active OA メンバー。
//   加えて「作品を無効化してもプレイヤー/予約/LIFF リンクを物理削除しない」ことを確認する。
//
// 通常の CI/`vitest run` では **skip**（DB 不要・compile のみ）。実 DB 検証時のみ:
//   UZUPRO_DB_TEST=1 DATABASE_URL=postgresql://...@127.0.0.1:PORT/postgres npx vitest run src/__tests__/uzupro-work-access-db.test.ts
// ※ localhost の使い捨て test DB のみで実行すること（本番/共有 DB では実行しない）。

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { canAccessUzuPro, isWorkUzuProEnabled } from "@/lib/uzupro";

const RUN = !!process.env.UZUPRO_DB_TEST;
const prisma = new PrismaClient();

// platform owner / ADMIN_IDENTITY へ誤ってヒットしないランダム ID（RBAC 迂回経路を踏まないため）
const U_FULL = `uzu-full-${randomUUID()}`; // grant + active member
const U_NOGRANT = `uzu-nogrant-${randomUUID()}`; // active member, grant なし
const U_NOTMEMBER = `uzu-notmember-${randomUUID()}`; // grant あり, member でない

describe.skipIf(!RUN)("uzupro work-access live-DB integration", () => {
  let oaId = "";
  let workId = "";
  let sessionId = "";

  beforeAll(async () => {
    // 決定性のため uzu_pro 系テーブルをクリア（使い捨て localhost test DB のみ）。
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "uzu_pro_liff_links","uzu_pro_players","uzu_pro_bookings","uzu_pro_sync_requests","uzu_pro_activity_logs","uzu_pro_grants" CASCADE`,
    );
    const oa = await prisma.oa.create({
      data: { title: "wa-itest", channelId: "c", channelSecret: "s", channelAccessToken: "a" },
    });
    oaId = oa.id;
    const work = await prisma.work.create({ data: { oaId, title: "w" } });
    workId = work.id;
    const s = await prisma.liveSession.create({
      data: {
        oaId,
        workId,
        name: "sess",
        origin: "UZU_PRO",
        externalSessionRef: "ext-s-wa-itest",
        startsAt: new Date("2026-08-01T10:00:00Z"),
      },
    });
    sessionId = s.id;

    // fixtures: grant + membership の各組み合わせ
    await prisma.uzuProGrant.create({ data: { userId: U_FULL, grantedBy: "tester" } });
    await prisma.uzuProGrant.create({ data: { userId: U_NOTMEMBER, grantedBy: "tester" } });
    await prisma.workspaceMember.create({
      data: { workspaceId: oaId, userId: U_FULL, status: "active", role: "editor" },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: oaId, userId: U_NOGRANT, status: "active", role: "editor" },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const setEnabled = (v: boolean) => prisma.work.update({ where: { id: workId }, data: { uzuProEnabled: v } });

  it("新規作品は uzuProEnabled=false（既定）", async () => {
    const w = await prisma.work.findUnique({ where: { id: workId }, select: { uzuProEnabled: true } });
    expect(w?.uzuProEnabled).toBe(false);
    expect(await isWorkUzuProEnabled(oaId, workId)).toBe(false);
  });

  it("作品有効化 + grant + active member の 3 条件すべてで canAccessUzuPro=true", async () => {
    await setEnabled(true);
    expect(await canAccessUzuPro(oaId, U_FULL, workId)).toBe(true);
  });

  it("いずれか 1 条件を欠くと false（grant 無し / member 無し / 作品無効化）", async () => {
    await setEnabled(true);
    // grant 無し（active member だが grant なし）
    expect(await canAccessUzuPro(oaId, U_NOGRANT, workId)).toBe(false);
    // member 無し（grant はあるが membership なし）
    expect(await canAccessUzuPro(oaId, U_NOTMEMBER, workId)).toBe(false);
    // 作品無効化（full user でも false）
    await setEnabled(false);
    expect(await canAccessUzuPro(oaId, U_FULL, workId)).toBe(false);
    await setEnabled(true);
  });

  it("作品無効化はプレイヤー/予約/LIFF リンクを物理削除しない", async () => {
    // booking + player + issued LIFF link を用意
    const booking = await prisma.uzuProBooking.create({
      data: {
        oaId,
        workId,
        liveSessionId: sessionId,
        externalBookingId: `wa-keep-${randomUUID()}`,
        participantCount: 1,
        sourceUpdatedAt: new Date(),
        syncedAt: new Date(),
      },
    });
    const player = await prisma.uzuProPlayer.create({
      data: { oaId, bookingId: booking.id, playerIndex: 1 },
    });
    const link = await prisma.uzuProLiffLink.create({
      data: { oaId, playerId: player.id, tokenHash: `h-${randomUUID()}`, status: "issued" },
    });

    // 無効化してもアクセス判定が変わるだけで、データは残る
    await setEnabled(false);
    expect(await canAccessUzuPro(oaId, U_FULL, workId)).toBe(false);

    expect(await prisma.uzuProBooking.count({ where: { id: booking.id } })).toBe(1);
    expect(await prisma.uzuProPlayer.count({ where: { id: player.id } })).toBe(1);
    expect(await prisma.uzuProLiffLink.count({ where: { id: link.id } })).toBe(1);

    // 再有効化で復帰
    await setEnabled(true);
    expect(await canAccessUzuPro(oaId, U_FULL, workId)).toBe(true);
  });
});
