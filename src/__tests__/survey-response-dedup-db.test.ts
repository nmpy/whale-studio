// src/__tests__/survey-response-dedup-db.test.ts
// LiffSurveyResponse の重複回答防止（dedupe_key UNIQUE）と回答済み判定クエリの実 PostgreSQL 検証。
//
// 通常の CI/`vitest run` では skip。実 DB 検証時のみ:
//   SURVEY_DB_TEST=1 DATABASE_URL=postgresql://...@127.0.0.1:PORT/db npx vitest run src/__tests__/survey-response-dedup-db.test.ts
// ※ localhost の使い捨て test DB のみで実行すること。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";

const RUN = process.env.SURVEY_DB_TEST === "1";
const prisma = new PrismaClient();

describe.skipIf(!RUN)("LiffSurveyResponse dedup live-DB", () => {
  let workId = "";
  let pageId = "";

  beforeAll(async () => {
    const oa = await prisma.oa.create({
      data: { title: "itest-survey", channelId: "c", channelSecret: "s", channelAccessToken: "a" },
    });
    const work = await prisma.work.create({ data: { oaId: oa.id, title: "w" } });
    workId = work.id;
    const pageRow = await prisma.liffPageConfig.create({ data: { workId, pageType: "survey" } });
    pageId = pageRow.id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const uid = (l: string) => `U${l}`.padEnd(33, "0");
  const mk = (dedupeKey: string | null, lineUserId: string | null) =>
    prisma.liffSurveyResponse.create({
      data: { workId, liffPageConfigId: pageId, lineUserId, dedupeKey, answersJson: { q0: "x" } as Prisma.InputJsonValue },
    });

  it("同一 dedupeKey の 2 回目は UNIQUE 違反(P2002)", async () => {
    const key = `${pageId}:${uid("dup")}`;
    await mk(key, uid("dup"));
    await expect(mk(key, uid("dup"))).rejects.toMatchObject({ code: "P2002" });
  });

  it("dedupeKey=null は複数許可（複数回答許可 / 匿名）", async () => {
    await mk(null, null);
    await mk(null, null);
    const n = await prisma.liffSurveyResponse.count({ where: { liffPageConfigId: pageId, dedupeKey: null } });
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("回答済み判定クエリ (liffPageConfigId, lineUserId) が該当行を返す", async () => {
    const u = uid("ans");
    await mk(`${pageId}:${u}`, u);
    const found = await prisma.liffSurveyResponse.findFirst({ where: { liffPageConfigId: pageId, lineUserId: u }, select: { id: true } });
    expect(found).not.toBeNull();
    const none = await prisma.liffSurveyResponse.findFirst({ where: { liffPageConfigId: pageId, lineUserId: uid("never") }, select: { id: true } });
    expect(none).toBeNull();
  });

  it("並行: 同一 dedupeKey へ 5 並行 create → ちょうど 1 件成功、他は P2002", async () => {
    const u = uid("race");
    const key = `${pageId}:${u}`;
    const res = await Promise.allSettled(Array.from({ length: 5 }, () => mk(key, u)));
    const ok = res.filter((r) => r.status === "fulfilled");
    const p2002 = res.filter((r) => r.status === "rejected" && (r.reason as { code?: string })?.code === "P2002");
    expect(ok).toHaveLength(1);
    expect(p2002).toHaveLength(4);
  });

  it("ページ削除で回答は残る（FK SET NULL）", async () => {
    const oa2 = await prisma.oa.create({ data: { title: "itest-survey2", channelId: "c2", channelSecret: "s", channelAccessToken: "a" } });
    const w2 = await prisma.work.create({ data: { oaId: oa2.id, title: "w2" } });
    const p2 = await prisma.liffPageConfig.create({ data: { workId: w2.id, pageType: "survey" } });
    const u = uid("setnull");
    const r = await prisma.liffSurveyResponse.create({
      data: { workId: w2.id, liffPageConfigId: p2.id, lineUserId: u, dedupeKey: `${p2.id}:${u}`, answersJson: {} as Prisma.InputJsonValue },
    });
    await prisma.liffPageConfig.delete({ where: { id: p2.id } });
    const still = await prisma.liffSurveyResponse.findUnique({ where: { id: r.id }, select: { id: true, liffPageConfigId: true } });
    expect(still).not.toBeNull();
    expect(still?.liffPageConfigId).toBeNull();
  });
});
