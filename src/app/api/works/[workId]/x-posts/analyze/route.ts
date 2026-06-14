// src/app/api/works/[workId]/x-posts/analyze/route.ts
// POST /api/works/[workId]/x-posts/analyze — 取り込み済み口コミの分析を再実行（editor 以上）。
// ルールベース（将来 LLM 差し替え可）。X API / スクレイピングは使わない。

import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { analyzeSentiment, analyzeRepeatIntent } from "@/lib/x-posts/nlp";

export const dynamic = "force-dynamic";

export const POST = withAuth<{ workId: string }>(async (_req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");
    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const mentions = await prisma.xImportedMention.findMany({ where: { oaId, workId }, select: { id: true, text: true } });
    let analyzed = 0;
    for (const m of mentions) {
      try {
        const s = analyzeSentiment(m.text);
        const r = analyzeRepeatIntent(m.text);
        const payload = {
          oaId, workId, mentionId: m.id,
          sentiment: s.sentiment, sentimentScore: s.score,
          repeatIntent: r.repeatIntent, repeatIntentScore: r.score,
          matchedKeywords: JSON.stringify([...new Set([...s.matched, ...r.matched])]),
        };
        await prisma.xImportedMentionAnalysis.upsert({
          where:  { mentionId: m.id },
          create: payload,
          update: { sentiment: payload.sentiment, sentimentScore: payload.sentimentScore, repeatIntent: payload.repeatIntent, repeatIntentScore: payload.repeatIntentScore, matchedKeywords: payload.matchedKeywords, analyzedAt: new Date() },
        });
        analyzed++;
      } catch { /* skip individual failure */ }
    }
    return ok({ analyzed });
  } catch (err) {
    return serverError(err);
  }
});
