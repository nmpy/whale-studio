// src/app/api/works/[workId]/liff-pages/analytics-summary/route.ts
// GET /api/works/[workId]/liff-pages/analytics-summary
//
// LIFF 一覧画面で各ページ行の右側に KPI (PV / UU / CTR / page_type 固有指標) を出すための集計エンドポイント。
// 1 リクエストで作品配下の全 LIFF ページの数値をまとめて返す。
//
// page_type 別の固有指標:
//   - default   → checkin_success の件数
//   - survey    → survey_submit の件数
//   - faq       → faq_open の件数
//   - hint      → hint_open の件数
//   - location  → 固有指標なし (page_view / unique_users のみ)
//
// 認証は viewer 以上。workId は publicId でも UUID でも受け付ける。

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { findWorkByIdOrPublicId } from "@/lib/public-id-resolver";

export const dynamic = "force-dynamic";

interface PageSummary {
  page_id:           string;
  page_public_id:    string | null;
  page_type:         string;
  page_view:         number;
  unique_users:      number;
  button_click:      number;
  ctr:               number;
  /** page_type 固有指標 (上のいずれかの数値、null なら指標なし) */
  page_type_metric_key:   string | null;
  page_type_metric_count: number | null;
}

export const GET = withAuth(async (req, ctx, user) => {
  try {
    const { workId: workIdOrPublic } = await ctx.params;

    const work = await findWorkByIdOrPublicId(workIdOrPublic);
    if (!work) return notFound("Work");

    const oaId = await getOaIdFromWorkId(work.id);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    // ── 作品配下の LIFF ページ一覧 ──
    const pages = await prisma.liffPageConfig.findMany({
      where: { workId: work.id },
      select: { id: true, publicId: true, pageType: true },
    });
    if (pages.length === 0) {
      return ok({
        work_id:        work.id,
        work_public_id: work.publicId,
        pages:          [] as PageSummary[],
      });
    }

    const pageIds = pages.map((p) => p.id);
    const hasDefaultPage = pages.some((p) => p.pageType === "default");

    // ── イベント数集計 (page x event_type) ──
    const eventCounts = await prisma.liffEventLog.groupBy({
      by: ["liffPageConfigId", "eventType"],
      where: { workId: work.id, liffPageConfigId: { in: pageIds } },
      _count: { _all: true },
    });

    // ── checkin 系イベントは pageId-less で保存される (location 起点) ため、
    //   default ページの metric として表示するには work 単位で別途集計する。
    //   work に default ページが 1 つも無ければクエリ自体を省く。
    let workCheckinSuccess = 0;
    if (hasDefaultPage) {
      workCheckinSuccess = await prisma.liffEventLog.count({
        where: { workId: work.id, eventType: "checkin_success" },
      });
    }

    // ── ユニークユーザー集計 (page_id ごと、line_user_id != null) ──
    // groupBy では DISTINCT 集計ができないので raw クエリ。
    const uniqueUsersRows = await prisma.$queryRaw<
      { liff_page_config_id: string; unique_users: bigint }[]
    >(
      Prisma.sql`SELECT liff_page_config_id, COUNT(DISTINCT line_user_id)::bigint AS unique_users
                 FROM liff_event_logs
                 WHERE work_id = ${work.id}
                   AND liff_page_config_id IN (${Prisma.join(pageIds)})
                   AND line_user_id IS NOT NULL
                 GROUP BY liff_page_config_id`
    );

    // 集計を page_id ごとにマージ
    const byPage = new Map<string, { events: Record<string, number>; uu: number }>();
    for (const p of pages) byPage.set(p.id, { events: {}, uu: 0 });

    for (const row of eventCounts) {
      if (!row.liffPageConfigId) continue;
      const bucket = byPage.get(row.liffPageConfigId);
      if (!bucket) continue;
      bucket.events[row.eventType] = row._count._all;
    }
    for (const row of uniqueUsersRows) {
      const bucket = byPage.get(row.liff_page_config_id);
      if (!bucket) continue;
      bucket.uu = Number(row.unique_users);
    }

    // ── 整形 ──
    const summaries: PageSummary[] = pages.map((p) => {
      const bucket = byPage.get(p.id) ?? { events: {}, uu: 0 };
      const pageView    = bucket.events["page_view"] ?? 0;
      const buttonClick = bucket.events["button_click"] ?? 0;
      const ctr = pageView > 0 ? buttonClick / pageView : 0;

      // page_type 固有指標
      let metricKey:   string | null = null;
      let metricCount: number | null = null;
      switch (p.pageType) {
        case "default":
          metricKey   = "checkin_success";
          // checkin イベントは pageId-less なので、work 単位の集計値を全 default ページに同じ値で出す。
          // 1 つの work に複数 default ページがある場合、どのページから来た checkin かは区別できないため
          // すべての default ページに work-level の合計を表示する。
          metricCount = workCheckinSuccess;
          break;
        case "survey":
          metricKey   = "survey_submit";
          metricCount = bucket.events["survey_submit"] ?? 0;
          break;
        case "faq":
          metricKey   = "faq_open";
          metricCount = bucket.events["faq_open"] ?? 0;
          break;
        case "hint":
          metricKey   = "hint_open";
          metricCount = bucket.events["hint_open"] ?? 0;
          break;
        default:
          metricKey   = null;
          metricCount = null;
      }

      return {
        page_id:                p.id,
        page_public_id:         p.publicId,
        page_type:              p.pageType,
        page_view:              pageView,
        unique_users:           bucket.uu,
        button_click:           buttonClick,
        ctr,
        page_type_metric_key:   metricKey,
        page_type_metric_count: metricCount,
      };
    });

    return ok({
      work_id:        work.id,
      work_public_id: work.publicId,
      pages:          summaries,
    });
  } catch (err) {
    return serverError(err);
  }
});
