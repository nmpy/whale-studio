// src/app/api/works/[workId]/x-posts/route.ts
// GET  /api/works/[workId]/x-posts — X投稿一覧（viewer 以上）+ 計測URLクリック数集計
// POST /api/works/[workId]/x-posts — X投稿作成（editor 以上）。作成時に計測URLを発行。
//
// X API / スクレイピングは使わない。計測は /r/[trackingCode] のクリックログのみ。

import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { createXPostSchema, formatZodErrors } from "@/lib/validations";
import { toXPostResponse } from "@/lib/x-posts/response";
import { generateTrackingCode, buildTrackingUrl } from "@/lib/x-posts/tracking-server";
import { buildUtmUrl } from "@/lib/x-posts/format";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export const GET = withAuth<{ workId: string }>(async (_req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");
    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const posts = await prisma.xPost.findMany({
      where:   { oaId, workId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    // 計測URLクリック数を集計（総数 + ユニーク = distinct ipHash）。N+1 回避でまとめて取得。
    const ids = posts.map((p) => p.id);
    const totals = ids.length
      ? await prisma.xPostClickEvent.groupBy({ by: ["xPostId"], where: { xPostId: { in: ids } }, _count: { _all: true } })
      : [];
    const totalByPost = new Map(totals.map((t) => [t.xPostId, t._count._all]));
    // ユニーク: ipHash の distinct 件数（ipHash=null は 1 扱いにせず除外集計＝参考値）。
    const uniqueRows = ids.length
      ? await prisma.xPostClickEvent.findMany({
          where: { xPostId: { in: ids }, ipHash: { not: null } },
          distinct: ["xPostId", "ipHash"],
          select: { xPostId: true },
        })
      : [];
    const uniqueByPost = new Map<string, number>();
    for (const r of uniqueRows) uniqueByPost.set(r.xPostId, (uniqueByPost.get(r.xPostId) ?? 0) + 1);

    return ok(posts.map((p) => toXPostResponse(p, {
      total:  totalByPost.get(p.id) ?? 0,
      unique: uniqueByPost.get(p.id) ?? 0,
    })));
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withAuth<{ workId: string }>(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");
    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = createXPostSchema.parse(body);

    // 計測URLを発行（衝突しない一意コード）。
    let trackingCode = generateTrackingCode();
    for (let i = 0; i < 5; i++) {
      const dup = await prisma.xPost.findUnique({ where: { trackingCode }, select: { id: true } });
      if (!dup) break;
      trackingCode = generateTrackingCode();
    }
    const trackingUrl = buildTrackingUrl(trackingCode, new URL(req.url).origin);

    // UTM 有効時は generated_url を再計算（クライアントからの値があってもサーバーで確定）。
    const linkUrl = (data.link_url ?? "").trim() || null;
    const generatedUrl = data.utm_enabled && linkUrl
      ? buildUtmUrl(linkUrl, {
          source: data.utm_source, medium: data.utm_medium, campaign: data.utm_campaign,
          content: data.utm_content, term: data.utm_term,
        })
      : (data.generated_url || null);

    const post = await prisma.xPost.create({
      data: {
        oaId, workId,
        title:            data.title ?? null,
        body:             data.body ?? null,
        hashtags:         data.hashtags && data.hashtags.length > 0 ? JSON.stringify(data.hashtags) : null,
        imageUrl:         data.image_url || null,
        uploadedImageUrl: data.uploaded_image_url || null,
        linkUrl,
        utmEnabled:       data.utm_enabled ?? false,
        utmName:          data.utm_name ?? null,
        utmSource:        data.utm_source ?? null,
        utmMedium:        data.utm_medium ?? null,
        utmCampaign:      data.utm_campaign ?? null,
        utmContent:       data.utm_content ?? null,
        utmTerm:          data.utm_term ?? null,
        generatedUrl,
        trackingCode,
        trackingUrl,
        xPostUrl:         data.x_post_url || null,
        status:           data.status ?? "draft",
        note:             data.note ?? null,
        postedAt:         parseDate(data.posted_at),
        scheduledAt:      parseDate(data.scheduled_at),
        sortOrder:        data.sort_order ?? 0,
      },
    });

    return created(toXPostResponse(post));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    return serverError(err);
  }
});
