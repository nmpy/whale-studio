// GET /api/oas/[id]/works/[workId]/import/spreadsheet/template
// 取り込み用 .xlsx テンプレートを返す。feature flag OFF は 404。editor 以上・work は oaId 所属を確認。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { isSpreadsheetImportEnabled } from "@/lib/spreadsheet-import/ui-text";
import { buildTemplateWorkbook, TEMPLATE_FILENAME } from "@/lib/spreadsheet-import/template";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string; workId: string }>(async (_req, { params }, user) => {
  try {
    if (!isSpreadsheetImportEnabled()) return notFound("ページ");

    const oaId = params.id;
    const { workId } = params;

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const work = await prisma.work.findFirst({ where: { id: workId, oaId }, select: { id: true } });
    if (!work) return notFound("作品");

    const buffer = await buildTemplateWorkbook();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(TEMPLATE_FILENAME)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
