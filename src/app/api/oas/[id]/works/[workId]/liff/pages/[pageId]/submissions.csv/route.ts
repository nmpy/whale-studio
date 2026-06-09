// src/app/api/oas/[id]/works/[workId]/liff/pages/[pageId]/submissions.csv/route.ts
// GET — LIFF 回答結果の CSV ダウンロード（管理画面用）。
//
// 権限・テナント分離は submissions GET と同一。
// CSV は BOM 付き UTF-8（Excel で文字化けしない）。ファイル名: liff-submissions-${pageTitle}-${YYYYMMDD}.csv

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { findWorkByIdOrPublicId, findLiffPageConfigByIdOrPublicId } from "@/lib/public-id-resolver";
import { extractAnswerBlocks, buildSubmissionsCsv, type SubmissionRow } from "@/lib/liff/submission";

export const dynamic = "force-dynamic";

/** ファイル名向けに危険文字を除去。日本語は残す。 */
function safeFileNamePart(s: string): string {
  return (s || "page").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 40);
}

export const GET = withAuth<{ id: string; workId: string; pageId: string }>(async (_req, ctx, user) => {
  try {
    const { id: oaIdParam, workId: workIdOrPublic, pageId: pageIdOrPublic } = await ctx.params;

    const work = await findWorkByIdOrPublicId(workIdOrPublic);
    if (!work) return notFound("Work");
    const oaId = await getOaIdFromWorkId(work.id);
    if (!oaId || oaId !== oaIdParam) return notFound("Work");
    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;
    const page = await findLiffPageConfigByIdOrPublicId(pageIdOrPublic, { workScope: work.id });
    if (!page) return notFound("LiffPage");

    const rows = await prisma.liffSubmission.findMany({
      where: { oaId, workId: work.id, liffPageId: page.id },
      orderBy: { createdAt: "desc" },
      select: { lineUserId: true, displayName: true, answersJson: true, createdAt: true },
    });

    const submissionRows: SubmissionRow[] = rows.map((r) => ({
      lineUserId:  r.lineUserId,
      displayName: r.displayName,
      createdAt:   r.createdAt.toISOString(),
      blocks:      extractAnswerBlocks(r.answersJson),
    }));

    const csv = buildSubmissionsCsv(submissionRows);

    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const fileName = `liff-submissions-${safeFileNamePart(page.title ?? "page")}-${ymd}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
