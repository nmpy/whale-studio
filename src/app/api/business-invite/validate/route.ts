// src/app/api/business-invite/validate/route.ts
// POST /api/business-invite/validate — token 検証 (公開・未認証可)
//
// セキュリティ:
//   - token は POST body で受け取る (= URL / query string に出さずログ露出を避ける)。
//   - DB には tokenHash のみ。受け取った平文 token を hash して lookup。
//   - plan / role / usageType は DB 解決して読み取り専用の表示用ラベルのみ返す。
//   - **usedAt は更新しない** (= 開いただけでは消費しない / 複数回閲覧可)。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import {
  hashBusinessInviteToken,
  businessInviteState,
  validateBusinessInviteSchema,
  planTierLabel,
  roleLabel,
  usageTypeLabel,
} from "@/lib/business-invite";
import { ZodError } from "zod";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { token } = validateBusinessInviteSchema.parse(body);

    const tokenHash = hashBusinessInviteToken(token);
    const link = await prisma.businessInviteLink.findUnique({ where: { tokenHash } });

    const state = businessInviteState(link);

    // none / used / expired / revoked は申込不可。表示用に state は返すが、
    // plan / role は active のときだけ返す (= 無効リンクで内容を露出しない)。
    if (!link || state !== "active") {
      return ok({ state, applicable: false });
    }

    return ok({
      state,
      applicable:       true,
      usage_type:       link.usageType,
      usage_type_label: usageTypeLabel(link.usageType),
      plan_tier:        link.planTier,
      plan_label:       planTierLabel(link.planTier),
      role:             link.role,
      role_label:       roleLabel(link.role),
      expires_at:       link.expiresAt?.toISOString() ?? null,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("token が不正です");
    return serverError(err);
  }
}
