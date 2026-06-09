// src/app/api/oas/[id]/liff-settings/route.ts
//
// OA 単位の LIFF 設定（liffId / endpoint メモ / Scan QR 想定フラグ）の取得・更新。
//
// - GET   : viewer 以上。現在値 + 解決済み liffId + 推奨 Endpoint URL + 解決元(source) を返す。
// - PATCH : owner のみ（= platform admin も getWorkspaceRole で owner 相当）。LIFF 表示プラン
//           (FEATURE.liffDisplay) を満たす場合のみ更新可。
//
// 既存 /api/oas/[id] (汎用 OA 設定 / owner) には手を入れず、LIFF 専用 + plan gate を
// 明確に分離するため独立ルートにしている。

import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { updateOaLiffSettingsSchema, formatZodErrors } from "@/lib/validations";
import { requirePlanFeature } from "@/lib/plan-guard";
import { FEATURE } from "@/lib/constants/plans";
import { invalidateOaCacheById } from "@/lib/oa-cache";
import {
  getLiffIdForOa,
  getLiffIdSource,
  isLiffConfigured,
  getRecommendedEndpointUrl,
} from "@/lib/liff/config";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

type OaLiffRow = { liffId: string | null; liffEndpointUrl: string | null; liffScanQrEnabled: boolean };

function toResponse(oa: OaLiffRow) {
  const resolved = getLiffIdForOa(oa);
  return {
    liff_id:                oa.liffId ?? null,
    liff_endpoint_url:      oa.liffEndpointUrl ?? null,
    liff_scan_qr_enabled:   oa.liffScanQrEnabled,
    /** 実際に Runtime で使われる liffId（Oa.liffId → NEXT_PUBLIC_LIFF_ID）。null=未設定。 */
    resolved_liff_id:       resolved,
    /** "oa" | "env" | "none" — UI で解決元を出し分ける。 */
    liff_id_source:         getLiffIdSource(oa),
    is_configured:          isLiffConfigured(oa),
    /** LINE Developers の Endpoint URL に設定すべき推奨値（…/liff）。 */
    recommended_endpoint_url: getRecommendedEndpointUrl(),
  };
}

// ── GET ───────────────────────────────────────────
export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  "viewer",
  async (_req, { params }) => {
    try {
      const oa = await prisma.oa.findUnique({
        where:  { id: params.id },
        select: { liffId: true, liffEndpointUrl: true, liffScanQrEnabled: true },
      });
      if (!oa) return notFound("OA");
      return ok(toResponse(oa));
    } catch (err) {
      return serverError(err);
    }
  },
);

// ── PATCH ─── owner のみ + LIFF 表示プラン必須
export const PATCH = withRole<{ id: string }>(
  ({ params }) => params.id,
  "owner",
  async (req, { params }) => {
    try {
      const existing = await prisma.oa.findUnique({
        where:  { id: params.id },
        select: { liffId: true, liffEndpointUrl: true, liffScanQrEnabled: true },
      });
      if (!existing) return notFound("OA");

      // LIFF 表示設定は Pro（plus）相当のプランが必要。
      const guard = await requirePlanFeature({ oaId: params.id, featureKey: FEATURE.liffDisplay });
      if (!guard.ok) return guard.response;

      const body = await req.json();
      const data = updateOaLiffSettingsSchema.parse(body);

      // 空文字は「クリア（null）」として正規化する。
      const norm = (v: string | null | undefined): string | null | undefined => {
        if (v === undefined) return undefined;
        if (v === null) return null;
        const t = v.trim();
        return t.length > 0 ? t : null;
      };

      const updated = await prisma.oa.update({
        where: { id: params.id },
        data: {
          ...(data.liff_id              !== undefined && { liffId:            norm(data.liff_id) }),
          ...(data.liff_endpoint_url    !== undefined && { liffEndpointUrl:   norm(data.liff_endpoint_url) }),
          ...(data.liff_scan_qr_enabled !== undefined && { liffScanQrEnabled: data.liff_scan_qr_enabled }),
        },
        select: { liffId: true, liffEndpointUrl: true, liffScanQrEnabled: true },
      });

      // OA fields を write したので id ベースのキャッシュを invalidate（CLAUDE.md / PR #160 方針）。
      await invalidateOaCacheById(params.id);

      return ok(toResponse(updated));
    } catch (err) {
      if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
      return serverError(err);
    }
  },
);
