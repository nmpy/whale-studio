// src/app/api/works/[workId]/x-posts/import/route.ts
// POST /api/works/[workId]/x-posts/import — CSV インポート（editor 以上）。
// body: { type: "metrics" | "mentions", rows: object[] }（CSV はクライアントで papaparse 済み）。
// X API / スクレイピングは使わない。CSV 由来の値のみを保存する。

import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { textHash, analyzeSentiment, analyzeRepeatIntent } from "@/lib/x-posts/nlp";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? "" : String(v)).trim();
const strOrNull = (v: unknown): string | null => { const s = str(v); return s || null; };
const intOf = (v: unknown): number => { const n = parseInt(str(v).replace(/[^0-9-]/g, ""), 10); return isNaN(n) ? 0 : n; };
const dateOrNull = (v: unknown): Date | null => { const s = str(v); if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d; };

// X投稿エクスポートで raw 保存する元データのキー。
const X_EXPORT_RAW_KEYS = [
  "id", "conversationId", "type", "geo", "mentions", "hashtags",
  "replyCount", "quoteCount", "retweetCount", "likeCount", "views", "bookmarkCount",
  "allMediaURL", "videoURL", "bio", "linkInBio", "profileURL", "followersCount", "followingCount",
];
function pickRawJson(row: Row): string | null {
  const raw: Record<string, unknown> = {};
  for (const k of X_EXPORT_RAW_KEYS) if (row[k] != null && str(row[k]) !== "") raw[k] = row[k];
  return Object.keys(raw).length > 0 ? JSON.stringify(raw) : null;
}

export const POST = withAuth<{ workId: string }>(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");
    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const body = await req.json().catch(() => ({}));
    const type = body?.type;
    const rows: Row[] = Array.isArray(body?.rows) ? body.rows : [];
    if (type !== "metrics" && type !== "mentions" && type !== "x_export")
      return badRequest("type は metrics / mentions / x_export のいずれかです");
    if (rows.length === 0) return badRequest("インポート対象の行がありません");
    if (rows.length > 5000) return badRequest("一度にインポートできるのは 5000 行までです");

    let imported = 0, skipped = 0, errors = 0;

    if (type === "metrics") {
      // 既存 XPost を xPostUrl で索引（workId スコープ）。
      const xposts = await prisma.xPost.findMany({ where: { oaId, workId }, select: { id: true, xPostUrl: true } });
      const byUrl = new Map(xposts.filter((p) => p.xPostUrl).map((p) => [p.xPostUrl as string, p.id]));

      for (const row of rows) {
        try {
          const xPostUrl = strOrNull(row.xPostUrl ?? row.x_post_url);
          const xPostExternalId = strOrNull(row.xPostId ?? row.x_post_id ?? row.xPostExternalId);
          const impressionsRaw = row.impressions ?? row.Impressions;
          // 必須: (xPostUrl または xPostExternalId) かつ impressions
          if ((!xPostUrl && !xPostExternalId) || impressionsRaw == null || str(impressionsRaw) === "") { skipped++; continue; }

          const linkedXPostId = xPostUrl ? (byUrl.get(xPostUrl) ?? null) : null;
          const data = {
            oaId, workId,
            xPostId:         linkedXPostId,
            xPostUrl,
            xPostExternalId,
            postTitle:       strOrNull(row.postTitle ?? row.post_title),
            postedAt:        dateOrNull(row.postedAt ?? row.posted_at),
            impressions:     intOf(impressionsRaw),
            likes:           intOf(row.likes),
            reposts:         intOf(row.reposts),
            replies:         intOf(row.replies),
            quotes:          intOf(row.quotes),
            bookmarks:       intOf(row.bookmarks),
            csvUrlClicks:    intOf(row.urlClicks ?? row.url_clicks ?? row.csvUrlClicks),
            note:            strOrNull(row.note),
          };
          // 重複（同 workId + 同 xPostUrl / xPostExternalId）は更新、なければ作成。
          const existing = await prisma.xPostImportedMetric.findFirst({
            where: { workId, ...(xPostUrl ? { xPostUrl } : { xPostExternalId }) },
            select: { id: true },
          });
          if (existing) await prisma.xPostImportedMetric.update({ where: { id: existing.id }, data });
          else await prisma.xPostImportedMetric.create({ data });
          imported++;
        } catch { errors++; }
      }
    } else if (type === "mentions") {
      const relatedPosts = await prisma.xPost.findMany({ where: { oaId, workId }, select: { id: true, xPostUrl: true } });
      const byUrl = new Map(relatedPosts.filter((p) => p.xPostUrl).map((p) => [p.xPostUrl as string, p.id]));

      for (const row of rows) {
        try {
          const text = str(row.text);
          if (!text) { skipped++; continue; } // 空行スキップ
          const url = strOrNull(row.url);
          const hash = textHash(text);
          // 重複: url 一致 or textHash 一致（workId スコープ）→ スキップ
          const dup = await prisma.xImportedMention.findFirst({
            where: { workId, OR: [...(url ? [{ url }] : []), { textHash: hash }] },
            select: { id: true },
          });
          if (dup) { skipped++; continue; }

          const relatedUrl = strOrNull(row.relatedXPostUrl ?? row.related_x_post_url);
          const relatedXPostId = relatedUrl ? (byUrl.get(relatedUrl) ?? null) : null;

          const mention = await prisma.xImportedMention.create({
            data: {
              oaId, workId,
              relatedXPostId, relatedXPostUrl: relatedUrl,
              postedAt:     dateOrNull(row.postedAt ?? row.posted_at),
              authorName:   strOrNull(row.authorName ?? row.author_name),
              authorHandle: strOrNull(row.authorHandle ?? row.author_handle),
              text, textHash: hash,
              url,
              source:       strOrNull(row.source),
              note:         strOrNull(row.note),
            },
          });
          // 分析（ルールベース）を同時に保存。
          const s = analyzeSentiment(text);
          const r = analyzeRepeatIntent(text);
          await prisma.xImportedMentionAnalysis.create({
            data: {
              oaId, workId, mentionId: mention.id,
              sentiment: s.sentiment, sentimentScore: s.score,
              repeatIntent: r.repeatIntent, repeatIntentScore: r.score,
              matchedKeywords: JSON.stringify([...new Set([...s.matched, ...r.matched])]),
            },
          });
          imported++;
        } catch { errors++; }
      }
    } else {
      // x_export: X投稿エクスポート形式。1行から 投稿実績 + 口コミ + 分析 を作成。
      const xposts = await prisma.xPost.findMany({ where: { oaId, workId }, select: { id: true, xPostUrl: true } });
      const byUrl = new Map(xposts.filter((p) => p.xPostUrl).map((p) => [p.xPostUrl as string, p.id]));

      for (const row of rows) {
        try {
          const text = str(row.tweetText);
          if (!text) { skipped++; continue; } // tweetText 必須・空行スキップ
          const tweetUrl = strOrNull(row.tweetURL ?? row.tweet_url);
          const externalId = strOrNull(row.id);
          const postedAt = dateOrNull(row.createdAt ?? row.created_at);
          const rawJson = pickRawJson(row);
          const linkedXPostId = tweetUrl ? (byUrl.get(tweetUrl) ?? null) : null;

          // A) 投稿実績（views→impressions, retweetCount→reposts 等）。tweetURL / id をキーに upsert。
          const metricData = {
            oaId, workId,
            xPostId:         linkedXPostId,
            xPostUrl:        tweetUrl,
            xPostExternalId: externalId,
            postTitle:       text.slice(0, 80),
            postedAt,
            impressions:     intOf(row.views),
            likes:           intOf(row.likeCount),
            reposts:         intOf(row.retweetCount),
            replies:         intOf(row.replyCount),
            quotes:          intOf(row.quoteCount),
            bookmarks:       intOf(row.bookmarkCount),
            csvUrlClicks:    0, // この形式に URL クリックは含まれない
            rawJson,
          };
          if (tweetUrl || externalId) {
            const existing = await prisma.xPostImportedMetric.findFirst({
              where: { workId, ...(tweetUrl ? { xPostUrl: tweetUrl } : { xPostExternalId: externalId }) },
              select: { id: true },
            });
            if (existing) await prisma.xPostImportedMetric.update({ where: { id: existing.id }, data: metricData });
            else await prisma.xPostImportedMetric.create({ data: metricData });
          } else {
            await prisma.xPostImportedMetric.create({ data: metricData });
          }

          // B/C) 口コミ + 分析。重複: tweetURL 優先 → textHash。重複なら口コミはスキップ（実績は upsert 済み）。
          const hash = textHash(text);
          const dup = await prisma.xImportedMention.findFirst({
            where: { workId, OR: [...(tweetUrl ? [{ url: tweetUrl }] : []), { textHash: hash }] },
            select: { id: true },
          });
          if (!dup) {
            const mention = await prisma.xImportedMention.create({
              data: {
                oaId, workId,
                relatedXPostId: linkedXPostId, relatedXPostUrl: tweetUrl,
                postedAt,
                authorName:   strOrNull(row.tweetAuthor),
                authorHandle: strOrNull(row.handle),
                text, textHash: hash,
                url:          tweetUrl,
                source:       strOrNull(row.type),
                rawJson,
              },
            });
            const s = analyzeSentiment(text);
            const r = analyzeRepeatIntent(text);
            await prisma.xImportedMentionAnalysis.create({
              data: {
                oaId, workId, mentionId: mention.id,
                sentiment: s.sentiment, sentimentScore: s.score,
                repeatIntent: r.repeatIntent, repeatIntentScore: r.score,
                matchedKeywords: JSON.stringify([...new Set([...s.matched, ...r.matched])]),
              },
            });
          }
          imported++;
        } catch { errors++; }
      }
    }

    return ok({ imported, skipped, errors });
  } catch (err) {
    return serverError(err);
  }
});
