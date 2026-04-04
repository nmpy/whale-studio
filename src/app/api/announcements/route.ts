// src/app/api/announcements/route.ts
// GET /api/announcements — 公開済みお知らせ一覧（全ユーザー向け）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";

function toResponse(a: {
  id: string;
  type: string;
  title: string;
  body: string;
  important: boolean;
  publishedAt: Date | null;
  sortOrder: number;
  createdBy: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id:           a.id,
    type:         a.type,
    title:        a.title,
    body:         a.body,
    important:    a.important,
    published_at: a.publishedAt?.toISOString() ?? null,
    sort_order:   a.sortOrder,
    created_by:   a.createdBy,
    updated_by:   a.updatedBy,
    created_at:   a.createdAt.toISOString(),
    updated_at:   a.updatedAt.toISOString(),
  };
}

// ── GET ──────────────────────────────────────────
export const GET = withAuth(async (_req: NextRequest) => {
  try {
    const now = new Date();
    const announcements = await prisma.adminAnnouncement.findMany({
      where: {
        publishedAt: {
          not:  null,
          lte:  now,
        },
      },
      orderBy: [
        { important:   "desc" },
        { sortOrder:   "asc" },
        { publishedAt: "desc" },
      ],
    });

    return ok(announcements.map(toResponse));
  } catch (err) {
    return serverError(err);
  }
});
