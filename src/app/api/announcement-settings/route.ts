// src/app/api/announcement-settings/route.ts
// GET /api/announcement-settings — /oas のお知らせ最大表示件数（表示用・全ログインユーザー）
//
// StudioSetting(singleton) から announcement_display_limit を読み、normalize して返す。
// DB 未作成（migration 未適用）/ 未設定 / null はすべて既定 3 にフォールバックする。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { normalizeAnnouncementLimit, DEFAULT_ANNOUNCEMENT_DISPLAY_LIMIT } from "@/lib/announcement-display";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req: NextRequest) => {
  try {
    const row = await prisma.studioSetting.findUnique({
      where:  { id: "singleton" },
      select: { announcementDisplayLimit: true },
    });
    return ok({ display_limit: normalizeAnnouncementLimit(row?.announcementDisplayLimit ?? null) });
  } catch {
    // テーブル未作成（本番 migration 未適用）等でも /oas を落とさず既定 3 を返す。
    return ok({ display_limit: DEFAULT_ANNOUNCEMENT_DISPLAY_LIMIT });
  }
});
