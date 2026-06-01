// src/app/api/admin/policies/route.ts
// GET  /api/admin/policies  — 規約文書バージョン一覧 (platform admin only)
// POST /api/admin/policies  — 新しいバージョンを作成 (= 下書き or 即時公開) (platform admin only)
//
// 認可: getServerUser + isPlatformOwner で固める (= /admin/live と同方針)。
// withPlatformAdmin は workspace owner も通すため使わない。

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, forbidden, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";
import { formatZodErrors } from "@/lib/validations";

export const dynamic = "force-dynamic";

const POLICY_TYPES = ["TERMS", "PRIVACY_POLICY"] as const;

const createBodySchema = z.object({
  type:        z.enum(POLICY_TYPES),
  version:     z.string().min(1, "version は必須です").max(50),
  title:       z.string().min(1, "title は必須です").max(200),
  body:        z.string().min(1, "body は必須です").max(50000),
  lastUpdated: z.string().max(50).optional().nullable(),
  effectiveAt: z.string().max(50).optional().nullable(),
  /** true なら作成と同時に公開 (= 既存公開版を非公開に下げる) */
  publish:     z.boolean().optional().default(false),
});

// ── GET ──────────────────────────────────────────────────
export const GET = withAuth(async (_req, _ctx, user) => {
  if (!isPlatformOwner(user.id)) return forbidden();

  try {
    const rows = await prisma.policyDocumentVersion.findMany({
      orderBy: [{ type: "asc" }, { createdAt: "desc" }],
      take:    200,
    });
    return ok(rows.map((r) => ({
      id:           r.id,
      type:         r.type,
      version:      r.version,
      title:        r.title,
      body:         r.body,
      last_updated: r.lastUpdated,
      effective_at: r.effectiveAt,
      is_published: r.isPublished,
      published_at: r.publishedAt,
      created_by:   r.createdBy,
      created_at:   r.createdAt,
      updated_at:   r.updatedAt,
    })));
  } catch (err) {
    return serverError(err);
  }
});

// ── POST: 新規バージョン作成 (= 下書き or 即時公開) ──
export const POST = withAuth(async (req, _ctx, user) => {
  if (!isPlatformOwner(user.id)) return forbidden();

  try {
    const body = await req.json().catch(() => ({}));
    const data = createBodySchema.parse(body);

    // 同 (type, version) の重複チェック
    const existing = await prisma.policyDocumentVersion.findUnique({
      where: { type_version: { type: data.type, version: data.version } },
    });
    if (existing) {
      return badRequest(`既に同じ type / version の文書が存在します (${data.type} / ${data.version})`);
    }

    // publish=true の場合は同 type の既存公開版を一括非公開にしてから作成 (= transaction)
    const created = await prisma.$transaction(async (tx) => {
      if (data.publish) {
        await tx.policyDocumentVersion.updateMany({
          where: { type: data.type, isPublished: true },
          data:  { isPublished: false },
        });
      }
      return tx.policyDocumentVersion.create({
        data: {
          type:        data.type,
          version:     data.version,
          title:       data.title,
          body:        data.body,
          lastUpdated: data.lastUpdated ?? null,
          effectiveAt: data.effectiveAt ?? null,
          isPublished: data.publish ?? false,
          publishedAt: data.publish ? new Date() : null,
          createdBy:   user.id,
        },
      });
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id:           created.id,
          type:         created.type,
          version:      created.version,
          is_published: created.isPublished,
          published_at: created.publishedAt,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
