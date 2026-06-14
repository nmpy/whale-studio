// src/app/api/works/[workId]/x-posts/[xPostId]/route.ts
// GET    — 単件取得（viewer 以上）
// PATCH  — 更新（editor 以上）。UTM 有効時は generated_url を再計算。
// DELETE — 削除（editor 以上）。

import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { updateXPostSchema, formatZodErrors } from "@/lib/validations";
import { toXPostResponse } from "@/lib/x-posts/response";
import { buildUtmUrl } from "@/lib/x-posts/format";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** 対象 X投稿が workId/oaId スコープに属するか検証して返す。 */
async function loadScoped(workId: string, xPostId: string) {
  const oaId = await getOaIdFromWorkId(workId);
  if (!oaId) return { oaId: null, post: null };
  const post = await prisma.xPost.findFirst({ where: { id: xPostId, workId, oaId } });
  return { oaId, post };
}

export const GET = withAuth<{ workId: string; xPostId: string }>(async (_req, ctx, user) => {
  try {
    const { workId, xPostId } = await ctx.params;
    const { oaId, post } = await loadScoped(workId, xPostId);
    if (!oaId || !post) return notFound("X投稿");
    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const total = await prisma.xPostClickEvent.count({ where: { xPostId } });
    const uniqueRows = await prisma.xPostClickEvent.findMany({
      where: { xPostId, ipHash: { not: null } }, distinct: ["ipHash"], select: { id: true },
    });
    return ok(toXPostResponse(post, { total, unique: uniqueRows.length }));
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withAuth<{ workId: string; xPostId: string }>(async (req, ctx, user) => {
  try {
    const { workId, xPostId } = await ctx.params;
    const { oaId, post } = await loadScoped(workId, xPostId);
    if (!oaId || !post) return notFound("X投稿");
    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = updateXPostSchema.parse(body);

    // UTM 関連が更新される場合に generated_url を再計算（link_url / utm_enabled は更新後の値で判定）。
    const nextLink = data.link_url !== undefined ? (data.link_url || null) : post.linkUrl;
    const nextUtmEnabled = data.utm_enabled !== undefined ? data.utm_enabled : post.utmEnabled;
    const utm = {
      source:   data.utm_source   !== undefined ? data.utm_source   : post.utmSource,
      medium:   data.utm_medium   !== undefined ? data.utm_medium   : post.utmMedium,
      campaign: data.utm_campaign !== undefined ? data.utm_campaign : post.utmCampaign,
      content:  data.utm_content  !== undefined ? data.utm_content  : post.utmContent,
      term:     data.utm_term     !== undefined ? data.utm_term     : post.utmTerm,
    };
    const recomputedGenerated = nextUtmEnabled && nextLink ? buildUtmUrl(nextLink, utm) : null;

    const updated = await prisma.xPost.update({
      where: { id: xPostId },
      data: {
        ...(data.title        !== undefined && { title:    data.title }),
        ...(data.body         !== undefined && { body:     data.body }),
        ...(data.hashtags     !== undefined && { hashtags: data.hashtags && data.hashtags.length > 0 ? JSON.stringify(data.hashtags) : null }),
        ...(data.image_url          !== undefined && { imageUrl:         data.image_url || null }),
        ...(data.uploaded_image_url !== undefined && { uploadedImageUrl: data.uploaded_image_url || null }),
        ...(data.link_url     !== undefined && { linkUrl:  data.link_url || null }),
        ...(data.utm_enabled  !== undefined && { utmEnabled:  data.utm_enabled }),
        ...(data.utm_name     !== undefined && { utmName:     data.utm_name }),
        ...(data.utm_source   !== undefined && { utmSource:   data.utm_source }),
        ...(data.utm_medium   !== undefined && { utmMedium:   data.utm_medium }),
        ...(data.utm_campaign !== undefined && { utmCampaign: data.utm_campaign }),
        ...(data.utm_content  !== undefined && { utmContent:  data.utm_content }),
        ...(data.utm_term     !== undefined && { utmTerm:     data.utm_term }),
        // generated_url は UTM/link 関連が更新されたら再計算、それ以外は据え置き。
        ...((data.link_url !== undefined || data.utm_enabled !== undefined || data.utm_source !== undefined
          || data.utm_medium !== undefined || data.utm_campaign !== undefined || data.utm_content !== undefined
          || data.utm_term !== undefined || data.generated_url !== undefined)
          && { generatedUrl: recomputedGenerated ?? (data.generated_url || null) }),
        ...(data.x_post_url   !== undefined && { xPostUrl: data.x_post_url || null }),
        ...(data.status       !== undefined && { status:   data.status }),
        ...(data.note         !== undefined && { note:     data.note }),
        ...(data.posted_at    !== undefined && { postedAt:    parseDate(data.posted_at) }),
        ...(data.scheduled_at !== undefined && { scheduledAt: parseDate(data.scheduled_at) }),
        ...(data.sort_order   !== undefined && { sortOrder: data.sort_order }),
      },
    });

    const total = await prisma.xPostClickEvent.count({ where: { xPostId } });
    return ok(toXPostResponse(updated, { total, unique: 0 }));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    return serverError(err);
  }
});

export const DELETE = withAuth<{ workId: string; xPostId: string }>(async (_req, ctx, user) => {
  try {
    const { workId, xPostId } = await ctx.params;
    const { oaId, post } = await loadScoped(workId, xPostId);
    if (!oaId || !post) return notFound("X投稿");
    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    await prisma.xPost.delete({ where: { id: xPostId } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
