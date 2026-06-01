// src/app/api/oas/[id]/route.ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { updateOaSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import { activeCache, CACHE_KEY } from "@/lib/cache";
import { invalidateOaCacheById } from "@/lib/oa-cache";
import { isLiveEnabled } from "@/lib/live";
import { genRequestId, runWithRequestId, withTiming } from "@/lib/perf";

// ── GET /api/oas/:id ─────────────────────────────
export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  'viewer',
  async (_req, { params }) =>
    runWithRequestId(genRequestId(), () => withTiming("api/oas-detail:GET", async () => {
    try {
      const oa = await withTiming("api/oas-detail:db:findUnique", () =>
        prisma.oa.findUnique({
          where: { id: params.id },
          include: { _count: { select: { works: true } } },
        }),
      );
      if (!oa) return notFound("OA");

      // Whale Studio Live の利用可否（隠し機能。entitlement 無効 OA では常に false）。
      // 内部で activeCache を経由するため、cache hit 時は DB を叩かない。
      const live_enabled = await withTiming("api/oas-detail:db:liveCheck", () =>
        isLiveEnabled(oa.id),
      );

      return ok({
        id:                   oa.id,
        title:                oa.title,
        description:          oa.description,
        channel_id:           oa.channelId,
        line_oa_id:           oa.lineOaId            ?? null,
        channel_secret:       oa.channelSecret,
        channel_access_token: oa.channelAccessToken,
        publish_status:       oa.publishStatus,
        rich_menu_id:         oa.richMenuId          ?? null,
        spreadsheet_id:       oa.spreadsheetId       ?? null,
        service_suspended_at: oa.serviceSuspendedAt  ?? null,
        live_enabled,
        created_at:           oa.createdAt,
        updated_at:           oa.updatedAt,
        _count:               oa._count,
      });
    } catch (err) {
      return serverError(err);
    }
    }))
);

// ── PATCH /api/oas/:id ─── owner のみ（重要設定）
export const PATCH = withRole<{ id: string }>(
  ({ params }) => params.id,
  'owner',
  async (req, { params }) => {
    try {
      const existing = await prisma.oa.findUnique({ where: { id: params.id } });
      if (!existing) return notFound("OA");

      const body = await req.json();
      const data = updateOaSchema.parse(body);

      const updated = await prisma.oa.update({
        where: { id: params.id },
        data: {
          ...(data.title                !== undefined && { title: data.title }),
          ...(data.description          !== undefined && { description: data.description }),
          ...(data.channel_id           !== undefined && { channelId: data.channel_id }),
          ...(data.line_oa_id           !== undefined && { lineOaId: data.line_oa_id }),
          ...(data.channel_secret       !== undefined && { channelSecret: data.channel_secret }),
          ...(data.channel_access_token !== undefined && { channelAccessToken: data.channel_access_token }),
          ...(data.publish_status       !== undefined && { publishStatus: data.publish_status }),
          ...(data.spreadsheet_id       !== undefined && { spreadsheetId: data.spreadsheet_id }),
          // サービス稼働状態トグル: true → 現在時刻をセット (= 停止中) / false → null (= 稼働中)。
          // publish_status とは独立。webhook が serviceSuspendedAt 非 null を見て早期 bail out する。
          ...(data.service_suspended    !== undefined && { serviceSuspendedAt: data.service_suspended ? new Date() : null }),
        },
      });

      // キャッシュ無効化（旧・新 lineOaId 両方を削除）
      if (existing.lineOaId) await activeCache.delete(CACHE_KEY.oa(existing.lineOaId));
      if (updated.lineOaId && updated.lineOaId !== existing.lineOaId) {
        await activeCache.delete(CACHE_KEY.oa(updated.lineOaId));
      }
      // PR #160: id ベースのキャッシュも invalidate (ownerKey や OA fields の write 後)
      await invalidateOaCacheById(params.id);

      return ok({
        id:                   updated.id,
        title:                updated.title,
        description:          updated.description,
        channel_id:           updated.channelId,
        line_oa_id:           updated.lineOaId            ?? null,
        publish_status:       updated.publishStatus,
        rich_menu_id:         updated.richMenuId          ?? null,
        spreadsheet_id:       updated.spreadsheetId       ?? null,
        service_suspended_at: updated.serviceSuspendedAt  ?? null,
        created_at:           updated.createdAt,
        updated_at:           updated.updatedAt,
      });
    } catch (err) {
      if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
      return serverError(err);
    }
  }
);

// ── DELETE /api/oas/:id ─── owner のみ
export const DELETE = withRole<{ id: string }>(
  ({ params }) => params.id,
  'owner',
  async (_req, { params }) => {
    try {
      const existing = await prisma.oa.findUnique({ where: { id: params.id } });
      if (!existing) return notFound("OA");

      await prisma.oa.delete({ where: { id: params.id } });
      // PR #160: id ベースのキャッシュを invalidate (DELETE 後は notFound 検出を遅延させない)
      await invalidateOaCacheById(params.id);
      // lineOaId 側 cache も削除 (= webhook 経路用)
      if (existing.lineOaId) await activeCache.delete(CACHE_KEY.oa(existing.lineOaId));
      return noContent();
    } catch (err) {
      return serverError(err);
    }
  }
);
