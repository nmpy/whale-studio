// src/app/api/admin/business-invite-links/route.ts
// GET  /api/admin/business-invite-links  — 発行済みリンク一覧 (platform admin 専用)
// POST /api/admin/business-invite-links  — リンク発行 (platform admin 専用)
//
// セキュリティ:
//   - platform admin (= isPlatformOwner) 以外は 404 で存在秘匿 (= 403 だと存在を露呈するため)。
//     workspace owner であっても platform admin でなければ不可。
//   - 平文 token は POST 発行レスポンスで一度だけ返す。DB には tokenHash のみ保存。
//   - plan / role / usageType は DB 保存し、URL には token のみを含める (= 改ざん防止)。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";
import {
  generateBusinessInviteToken,
  hashBusinessInviteToken,
  resolveExpiresAt,
  DEFAULT_EXPIRES_IN_DAYS,
  businessInviteState,
  issueBusinessInviteSchema,
  planTierLabel,
  roleLabel,
  usageTypeLabel,
} from "@/lib/business-invite";
import { ZodError } from "zod";
import { formatZodErrors } from "@/lib/validations";

type LinkRow = {
  id: string;
  usageType: string;
  planTier: string;
  role: string;
  note: string | null;
  expiresAt: Date | null;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
  application: { id: string; companyName: string; contactName: string; createdAt: Date } | null;
};

function toResponse(link: LinkRow) {
  return {
    id:               link.id,
    usage_type:       link.usageType,
    usage_type_label: usageTypeLabel(link.usageType),
    plan_tier:        link.planTier,
    plan_label:       planTierLabel(link.planTier),
    role:             link.role,
    role_label:       roleLabel(link.role),
    note:             link.note,
    state:            businessInviteState(link),
    expires_at:       link.expiresAt?.toISOString() ?? null,
    used_at:          link.usedAt?.toISOString() ?? null,
    revoked_at:       link.revokedAt?.toISOString() ?? null,
    created_at:       link.createdAt.toISOString(),
    application: link.application
      ? {
          id:           link.application.id,
          company_name: link.application.companyName,
          contact_name: link.application.contactName,
          created_at:   link.application.createdAt.toISOString(),
        }
      : null,
  };
}

// ── GET: 一覧 ───────────────────────────────────────────────
export const GET = withAuth(async (_req: NextRequest, _ctx, user) => {
  try {
    // platform admin 以外は 404 (= 存在秘匿)
    if (!isPlatformOwner(user.id)) return notFound("ページ");

    const links = await prisma.businessInviteLink.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        application: {
          select: { id: true, companyName: true, contactName: true, createdAt: true },
        },
      },
    });

    return ok(links.map(toResponse));
  } catch (err) {
    return serverError(err);
  }
});

// ── POST: 発行 ──────────────────────────────────────────────
export const POST = withAuth(async (req: NextRequest, _ctx, user) => {
  try {
    if (!isPlatformOwner(user.id)) return notFound("ページ");

    const body = await req.json();
    const data = issueBusinessInviteSchema.parse(body);

    // expiresInDays: 未指定 → 既定 30 日 / null → 無期限 / 正の整数 → その日数
    const expiresInDays =
      data.expiresInDays === undefined ? DEFAULT_EXPIRES_IN_DAYS : data.expiresInDays;
    const expiresAt = resolveExpiresAt(expiresInDays);

    // 平文 token は発行レスポンスで一度だけ返す。DB には hash のみ。
    const token = generateBusinessInviteToken();
    const tokenHash = hashBusinessInviteToken(token);

    const link = await prisma.businessInviteLink.create({
      data: {
        tokenHash,
        usageType:       data.usageType,
        planTier:        data.planTier,
        role:            data.role,
        note:            data.note ?? null,
        expiresAt,
        createdByUserId: user.id,
      },
      include: {
        application: {
          select: { id: true, companyName: true, contactName: true, createdAt: true },
        },
      },
    });

    // 申込 URL は token のみを含む。origin はリクエストから解決。
    const inviteUrl = `${req.nextUrl.origin}/apply/business/${token}`;

    return created({
      ...toResponse(link),
      // 平文 token / URL はこのレスポンスでしか取得できない (= 再表示不可)。
      token,
      invite_url: inviteUrl,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
