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
    if (type !== "metrics" && type !== "mentions") return badRequest("type は metrics / mentions のいずれかです");
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
    } else {
      // mentions
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
    }

    return ok({ imported, skipped, errors });
  } catch (err) {
    return serverError(err);
  }
});
