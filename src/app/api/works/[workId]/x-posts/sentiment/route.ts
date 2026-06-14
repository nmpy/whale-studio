// src/app/api/works/[workId]/x-posts/sentiment/route.ts
// GET /api/works/[workId]/x-posts/sentiment — 感情分析データ取得（viewer 以上）。
// CSV 取り込みの投稿実績（インプレッション）+ 口コミ + 分析結果を集計。
// X API / スクレイピングは使わない。インプレッションは CSV 由来の値のみ。

import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { frequentWords, REPEAT_HIGH_EXPRESSIONS } from "@/lib/x-posts/nlp";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ workId: string }>(async (_req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");
    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const [metrics, mentions] = await Promise.all([
      prisma.xPostImportedMetric.findMany({ where: { oaId, workId }, orderBy: { importedAt: "desc" } }),
      prisma.xImportedMention.findMany({ where: { oaId, workId }, orderBy: { importedAt: "desc" }, include: { analysis: true } }),
    ]);

    // 投稿実績に紐づく XPost の Whale Studio 計測URLクリック数（CSV URLクリックとは別物）。
    const linkedIds = Array.from(new Set(metrics.map((m) => m.xPostId).filter((x): x is string => !!x)));
    const wsClickRows = linkedIds.length
      ? await prisma.xPostClickEvent.groupBy({ by: ["xPostId"], where: { xPostId: { in: linkedIds } }, _count: { _all: true } })
      : [];
    const wsClickByPost = new Map(wsClickRows.map((r) => [r.xPostId, r._count._all]));

    // ── 投稿実績テーブル行 ──
    const cv = 0; // CV は attribution 未実装のため placeholder（PR2 と同様）
    const metricRows = metrics.map((m) => {
      const wsClicks = m.xPostId ? (wsClickByPost.get(m.xPostId) ?? 0) : 0;
      return {
        id: m.id,
        post_title: m.postTitle,
        x_post_url: m.xPostUrl,
        posted_at: m.postedAt ? m.postedAt.toISOString() : null,
        impressions: m.impressions,
        csv_url_clicks: m.csvUrlClicks,
        csv_url_click_rate: m.impressions > 0 ? m.csvUrlClicks / m.impressions : null,
        ws_click_count: wsClicks,
        cv_count: cv,
        impression_cvr: m.impressions > 0 ? cv / m.impressions : null,
        likes: m.likes, reposts: m.reposts, replies: m.replies, quotes: m.quotes, bookmarks: m.bookmarks,
        imported_at: m.importedAt.toISOString(),
      };
    });

    // ── 口コミテーブル行 ──
    const mentionRows = mentions.map((m) => ({
      id: m.id,
      posted_at: m.postedAt ? m.postedAt.toISOString() : null,
      text: m.text,
      url: m.url,
      related_x_post_url: m.relatedXPostUrl,
      sentiment: m.analysis?.sentiment ?? "unknown",
      repeat_intent: m.analysis?.repeatIntent ?? "unknown",
      source: m.source,
      imported_at: m.importedAt.toISOString(),
    }));

    // ── 頻出単語 ──
    const words = frequentWords(mentions.map((m) => ({ id: m.id, text: m.text })));

    // ── ポジネガ / リピート 集計 ──
    const sentimentCounts = { positive: 0, neutral: 0, negative: 0, unknown: 0 };
    const repeatCounts = { high: 0, medium: 0, low: 0, unknown: 0 };
    for (const m of mentions) {
      const s = (m.analysis?.sentiment ?? "unknown") as keyof typeof sentimentCounts;
      const r = (m.analysis?.repeatIntent ?? "unknown") as keyof typeof repeatCounts;
      if (s in sentimentCounts) sentimentCounts[s]++;
      if (r in repeatCounts) repeatCounts[r]++;
    }
    const analyzedCount = mentions.filter((m) => m.analysis).length;
    const total = mentions.length;

    // 代表コメント（positive の上位 / repeat high）。
    const repText = (m: typeof mentions[number]) => m.text.replace(/\s+/g, " ").trim().slice(0, 120);
    const positiveSamples = mentions.filter((m) => m.analysis?.sentiment === "positive").slice(0, 5).map(repText);
    const negativeSamples = mentions.filter((m) => m.analysis?.sentiment === "negative").slice(0, 5).map(repText);
    const repeatHighSamples = mentions.filter((m) => m.analysis?.repeatIntent === "high").slice(0, 5).map(repText);

    // リピート欲求が高い表現ランキング（high 表現の出現数）。
    const repeatHighRanking = REPEAT_HIGH_EXPRESSIONS
      .map((expr) => ({ expr, count: mentions.filter((m) => m.text.includes(expr)).length }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // ── サマリー ──
    const lastImport = [
      ...mentions.map((m) => m.importedAt.getTime()),
      ...metrics.map((m) => m.importedAt.getTime()),
    ];
    const lastAnalyzed = mentions.map((m) => m.analysis?.analyzedAt?.getTime() ?? 0).filter((x) => x > 0);
    const totalImpressions = metrics.reduce((s, m) => s + m.impressions, 0);
    const totalCsvClicks = metrics.reduce((s, m) => s + m.csvUrlClicks, 0);

    const summary = {
      mention_count: total,
      analyzed_count: analyzedCount,
      positive_rate: total > 0 ? sentimentCounts.positive / total : null,
      negative_rate: total > 0 ? sentimentCounts.negative / total : null,
      repeat_high_rate: total > 0 ? repeatCounts.high / total : null,
      last_imported_at: lastImport.length ? new Date(Math.max(...lastImport)).toISOString() : null,
      last_analyzed_at: lastAnalyzed.length ? new Date(Math.max(...lastAnalyzed)).toISOString() : null,
      // 投稿実績系
      metric_count: metrics.length,
      total_impressions: totalImpressions,
      avg_impressions: metrics.length > 0 ? Math.round(totalImpressions / metrics.length) : 0,
      csv_url_click_rate: totalImpressions > 0 ? totalCsvClicks / totalImpressions : null,
      impression_cvr: totalImpressions > 0 ? cv / totalImpressions : null,
    };

    return ok({
      summary,
      metric_rows: metricRows,
      mention_rows: mentionRows,
      frequent_words: words,
      sentiment_counts: sentimentCounts,
      repeat_counts: repeatCounts,
      representative: { positive: positiveSamples, negative: negativeSamples, repeat_high: repeatHighSamples },
      repeat_high_ranking: repeatHighRanking,
    });
  } catch (err) {
    return serverError(err);
  }
});
