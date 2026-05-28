// src/app/api/admin/oa-entitlements/route.ts
// GET   /api/admin/oa-entitlements — 全 OA + Whale Studio Live の有効状態（platform admin 専用）
// PATCH /api/admin/oa-entitlements — OA の Live を ON/OFF（upsert。物理削除せず enabled で制御）
//
// 認可は withPlatformAdmin が担保（platform admin / workspace owner 以外は 403）。
// ※ entitlement の変更は隠し機能の運用操作のため、UI も /admin（platform 専用）配下に置く。

import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withPlatformAdmin } from "@/lib/with-platform-admin";
import { LIVE_FEATURE_KEY } from "@/lib/live";
import { z, ZodError } from "zod";

export const dynamic = "force-dynamic";

export const GET = withPlatformAdmin(async () => {
  try {
    const oas = await prisma.oa.findMany({
      select: {
        id:    true,
        title: true,
        entitlements: {
          where:  { featureKey: LIVE_FEATURE_KEY },
          select: { enabled: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(
      oas.map((o) => ({
        oa_id:        o.id,
        title:        o.title,
        live_enabled: o.entitlements[0]?.enabled === true,
      })),
    );
  } catch (err) {
    return serverError(err);
  }
});

const patchSchema = z.object({
  oa_id:   z.string().min(1, "oa_id は必須です"),
  enabled: z.boolean(),
});

export const PATCH = withPlatformAdmin(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const { oa_id, enabled } = patchSchema.parse(body);

    // 存在しない OA への upsert は FK 制約違反になるため事前チェック
    const oa = await prisma.oa.findUnique({ where: { id: oa_id }, select: { id: true } });
    if (!oa) return notFound("OA");

    const ent = await prisma.oaEntitlement.upsert({
      where:  { oaId_featureKey: { oaId: oa_id, featureKey: LIVE_FEATURE_KEY } },
      create: { oaId: oa_id, featureKey: LIVE_FEATURE_KEY, enabled },
      update: { enabled },
    });

    return ok({
      oa_id,
      feature_key:  LIVE_FEATURE_KEY,
      live_enabled: ent.enabled,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力値が不正です", {
        oa_id:   err.issues.filter((i) => i.path[0] === "oa_id").map((i) => i.message),
        enabled: err.issues.filter((i) => i.path[0] === "enabled").map((i) => i.message),
      });
    }
    return serverError(err);
  }
});
