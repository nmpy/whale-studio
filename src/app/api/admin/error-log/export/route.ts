// GET /api/admin/error-log/export — 現在のフィルタ一致の全件（上限あり）を CSV 出力（platform owner 限定）。
//   - ページ単位ではなくフィルタ全件。ERROR_LOG_CSV_CAP で無制限取得を防ぐ。
//   - 生 LINE userId / 秘匿情報は View Model 正規化時点で除去済み。解決者は表示名に解決（生 userId は出さない）。

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";
import { forbidden, serverError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { parseFilters } from "@/lib/owner-error-log/filters";
import { queryErrorLogAll } from "@/lib/owner-error-log/query";
import { toErrorLogItem } from "@/lib/owner-error-log/normalize";
import { buildErrorLogCsv, errorLogCsvFileName } from "@/lib/owner-error-log/csv";
import { ERROR_LOG_CSV_CAP } from "@/lib/owner-error-log/service";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (req, _ctx, user) => {
  try {
    if (!isPlatformOwner(user.id)) return forbidden(); // workspace owner も不可（strict）

    const url = new URL(req.url);
    const sp: Record<string, string> = {};
    for (const [k, v] of url.searchParams.entries()) sp[k] = v;

    const oas = await prisma.oa.findMany({ select: { id: true, title: true } });
    const oaName = new Map(oas.map((o) => [o.id, o.title]));
    const filters = parseFilters(sp, new Set(oas.map((o) => o.id)));

    const now = new Date();
    const rows = await queryErrorLogAll(filters, now, ERROR_LOG_CSV_CAP);
    const items = rows.map((r) => toErrorLogItem(r, oaName.get(r.oaId) ?? "不明なアカウント"));

    // 解決者表示名の解決（生 userId は CSV に出さない）。resolved 行の sourceId で resolution を引く。
    const resolvedByName = new Map<string, string>();
    const resolvedSourceIds = rows.filter((r) => r.resolvedAt != null).map((r) => r.sourceId);
    if (resolvedSourceIds.length > 0) {
      const resolutions = await prisma.errorLogResolution.findMany({
        where: { sourceId: { in: resolvedSourceIds } },
        select: { source: true, sourceId: true, resolvedByUserId: true },
      });
      const userIds = [...new Set(resolutions.map((r) => r.resolvedByUserId))];
      const profiles = await prisma.profile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, username: true } });
      const nameByUser = new Map(profiles.map((p) => [p.userId, p.username]));
      for (const r of resolutions) {
        resolvedByName.set(`${r.source}:${r.sourceId}`, nameByUser.get(r.resolvedByUserId) ?? "オーナー");
      }
    }

    const csv = buildErrorLogCsv(items, resolvedByName);
    const fileName = errorLogCsvFileName(now);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
