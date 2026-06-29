// src/app/api/admin/announcement-settings/route.ts
// PATCH /api/admin/announcement-settings — お知らせ最大表示件数の更新（platform admin のみ）
//
// body: { display_limit: number }（1〜10）。保存時も normalize（範囲外は clamp・不正は既定 3）。
// StudioSetting(singleton, id="singleton") に upsert する。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { withPlatformAdmin } from "@/lib/with-platform-admin";
import { normalizeAnnouncementLimit } from "@/lib/announcement-display";

export const dynamic = "force-dynamic";

export const PATCH = withPlatformAdmin(async (req: NextRequest) => {
  try {
    const body = (await req.json().catch(() => null)) as { display_limit?: unknown } | null;
    if (!body || body.display_limit === undefined || body.display_limit === null) {
      return badRequest("display_limit は必須です");
    }
    // 保存時も normalize（範囲外は 1〜10 に clamp、不正値は既定 3）。
    const limit = normalizeAnnouncementLimit(body.display_limit);

    const row = await prisma.studioSetting.upsert({
      where:  { id: "singleton" },
      create: { id: "singleton", announcementDisplayLimit: limit },
      update: { announcementDisplayLimit: limit },
      select: { announcementDisplayLimit: true },
    });

    return ok({ display_limit: normalizeAnnouncementLimit(row.announcementDisplayLimit) });
  } catch (err) {
    return serverError(err);
  }
});
