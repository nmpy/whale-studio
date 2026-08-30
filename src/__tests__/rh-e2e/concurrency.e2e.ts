// src/__tests__/rh-e2e/concurrency.e2e.ts
// Postgres 固有の並行性・整合性 E2E（SQLite/モックでは検証不能な領域）。
// 実 docker PG に対して Promise.all で競合させ、unique 制約・atomic claim を確認する。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedSynthetic, cleanupOa, TEST_LINE_USER } from "./_seed";

let ids: Awaited<ReturnType<typeof seedSynthetic>>;

beforeAll(async () => {
  ids = await seedSynthetic("concurrency");
});
afterAll(async () => {
  await cleanupOa(ids.oaId);
  await prisma.$disconnect();
});

describe("UserProgress unique constraint under concurrency", () => {
  it("同一 (lineUserId, workId) の同時 create は 1 件のみ成功（unique [lineUserId,workId]）", async () => {
    const lu = `${TEST_LINE_USER}_race_create`;
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        prisma.userProgress.create({ data: { lineUserId: lu, workId: ids.workId, currentPhaseId: ids.startPhaseId, reachedEnding: false } }),
      ),
    );
    const ok = attempts.filter((a) => a.status === "fulfilled").length;
    const rejected = attempts.filter((a) => a.status === "rejected").length;
    const rows = await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } });
    expect(ok).toBe(1);
    expect(rejected).toBe(4);
    expect(rows).toBe(1); // DB 上も 1 行のみ（二重進行なし）
  });

  it("同時 upsert（webhook start 相当）は二重行を作らない", async () => {
    const lu = `${TEST_LINE_USER}_race_upsert`;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        prisma.userProgress.upsert({
          where: { lineUserId_workId: { lineUserId: lu, workId: ids.workId } },
          create: { lineUserId: lu, workId: ids.workId, currentPhaseId: null, reachedEnding: false },
          update: { currentPhaseId: null },
        }).catch(() => null), // 競合時の P2002 は upsert 内部 retry か例外。行数で最終確認する。
      ),
    );
    const rows = await prisma.userProgress.count({ where: { lineUserId: lu, workId: ids.workId } });
    expect(rows).toBe(1);
  });
});

describe("Scheduled message claim atomicity", () => {
  it("同一 pending 予約への同時 claim は 1 worker のみ成功（updateMany where status=pending）", async () => {
    // pending 予約を1件作る（合成）
    const sched = await prisma.scheduledLineMessage.create({
      data: {
        oaId: ids.oaId, workId: ids.workId, lineUserId: `${TEST_LINE_USER}_sched`,
        triggerType: "scheduled_setting", dueAt: new Date("2020-01-01T00:00:00Z"), status: "pending",
        payloadJson: JSON.stringify({ message_type: "text", body: "x" }),
        idempotencyKey: `rh-test-idem-${ids.workId}`,
      },
    });
    // 6 worker が同時に claim（pending→sending の updateMany）
    const claims = await Promise.all(
      Array.from({ length: 6 }, () =>
        prisma.scheduledLineMessage.updateMany({ where: { id: sched.id, status: "pending" }, data: { status: "sending" } })
          .then((r) => r.count),
      ),
    );
    const claimedTotal = claims.reduce((a, b) => a + b, 0);
    const finalRow = await prisma.scheduledLineMessage.findUnique({ where: { id: sched.id }, select: { status: true } });
    expect(claimedTotal).toBe(1); // ちょうど 1 worker だけが claim 成功
    expect(finalRow?.status).toBe("sending");
  });

  it("idempotencyKey unique により同一キーの二重予約を作れない", async () => {
    const key = `rh-test-idem-dup-${ids.workId}`;
    const mk = () => prisma.scheduledLineMessage.create({
      data: {
        oaId: ids.oaId, workId: ids.workId, lineUserId: `${TEST_LINE_USER}_dup`,
        triggerType: "scheduled_setting", dueAt: new Date(), status: "pending",
        payloadJson: "{}", idempotencyKey: key,
      },
    });
    const results = await Promise.allSettled([mk(), mk(), mk()]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const rows = await prisma.scheduledLineMessage.count({ where: { idempotencyKey: key } });
    expect(ok).toBe(1);
    expect(rows).toBe(1);
  });
});
