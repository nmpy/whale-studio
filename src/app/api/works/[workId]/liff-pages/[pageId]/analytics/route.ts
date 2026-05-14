// src/app/api/works/[workId]/liff-pages/[pageId]/analytics/route.ts
// GET /api/works/[workId]/liff-pages/[pageId]/analytics
//
// LIFF ページ詳細画面の "計測" タブ向けに、以下の集計を 1 レスポンスで返す:
//   - totals: page_view / unique users (lineUserId) / button_click / hint_open / faq_open など
//   - recent_events: 直近 50 件のイベントログ
//   - survey_responses (アンケートページのとき): 直近 50 件 + 集計用 answers
//   - checkin_summary (default ページ向け): 直近のチェックイン履歴 (Location 配下)
//
// 認証は CMS 用 (viewer 以上)。workId / pageId は publicId でも UUID でも受け付ける。

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import {
  findWorkByIdOrPublicId,
  findLiffPageConfigByIdOrPublicId,
} from "@/lib/public-id-resolver";

export const dynamic = "force-dynamic";

const RECENT_EVENTS_LIMIT  = 50;
const SURVEY_RECENT_LIMIT  = 50;
const CHECKIN_RECENT_LIMIT = 50;

export const GET = withAuth(async (req, ctx, user) => {
  try {
    const { workId: workIdOrPublic, pageId: pageIdOrPublic } = await ctx.params;

    const work = await findWorkByIdOrPublicId(workIdOrPublic);
    if (!work) return notFound("Work");

    const oaId = await getOaIdFromWorkId(work.id);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const page = await findLiffPageConfigByIdOrPublicId(pageIdOrPublic, { workScope: work.id });
    if (!page) return notFound("LiffPage");

    // ── イベント集計 ──
    // page_view: ページに紐づくもの (block 経由のイベントも page 経由でカウントしたいので
    // workId + pageId スコープで集計し、block レベルの内訳は別途返す)
    const eventTypeGroups = await prisma.liffEventLog.groupBy({
      by: ["eventType"],
      where: { workId: work.id, liffPageConfigId: page.id },
      _count: { _all: true },
    });

    // ユニークユーザー (lineUserId が null でないもの)
    const uniqueUsersRow = await prisma.$queryRaw<{ unique_users: bigint }[]>(
      Prisma.sql`SELECT COUNT(DISTINCT line_user_id)::bigint AS unique_users
                 FROM liff_event_logs
                 WHERE work_id = ${work.id}
                   AND liff_page_config_id = ${page.id}
                   AND line_user_id IS NOT NULL`
    );
    const uniqueUsers = Number(uniqueUsersRow[0]?.unique_users ?? 0);

    // ブロック別 button_click / hint_open 内訳 (analytics タブ用のミニリスト)
    const blockBreakdown = await prisma.liffEventLog.groupBy({
      by: ["liffPageBlockId", "eventType"],
      where: {
        workId:           work.id,
        liffPageConfigId: page.id,
        liffPageBlockId:  { not: null },
        eventType:        { in: ["button_click", "hint_open"] },
      },
      _count: { _all: true },
    });

    // 直近イベント (タイムライン表示用)
    const recentEvents = await prisma.liffEventLog.findMany({
      where: { workId: work.id, liffPageConfigId: page.id },
      orderBy: { createdAt: "desc" },
      take: RECENT_EVENTS_LIMIT,
      select: {
        id:               true,
        eventType:        true,
        lineUserId:       true,
        liffPageBlockId:  true,
        metadataJson:     true,
        createdAt:        true,
      },
    });

    // ── アンケート: page_type が "survey" のときのみアンケート回答リストも返す ──
    let surveyResponses: Array<{
      id:           string;
      line_user_id: string | null;
      answers_json: unknown;
      submitted_at: Date;
    }> | undefined;
    let surveyResponseCount: number | undefined;

    if (page.pageType === "survey") {
      const [items, count] = await Promise.all([
        prisma.liffSurveyResponse.findMany({
          where: { workId: work.id },
          orderBy: { submittedAt: "desc" },
          take: SURVEY_RECENT_LIMIT,
          select: { id: true, lineUserId: true, answersJson: true, submittedAt: true },
        }),
        prisma.liffSurveyResponse.count({ where: { workId: work.id } }),
      ]);
      surveyResponses = items.map((r) => ({
        id:           r.id,
        line_user_id: r.lineUserId,
        answers_json: r.answersJson,
        submitted_at: r.submittedAt,
      }));
      surveyResponseCount = count;
    }

    // ── チェックイン: default ページのときのみ ──
    let checkinSummary:
      | {
          recent: Array<{ id: string; location_id: string; location_name: string | null; line_user_id: string; checkin_method: string; visited_at: Date }>;
          total_count: number;
        }
      | undefined;

    if (page.pageType === "default") {
      const [visits, count] = await Promise.all([
        prisma.locationVisit.findMany({
          where: { workId: work.id },
          orderBy: { visitedAt: "desc" },
          take: CHECKIN_RECENT_LIMIT,
          include: { location: { select: { name: true } } },
        }),
        prisma.locationVisit.count({ where: { workId: work.id } }),
      ]);
      checkinSummary = {
        recent: visits.map((v) => ({
          id:             v.id,
          location_id:    v.locationId,
          location_name:  v.location?.name ?? null,
          line_user_id:   v.lineUserId,
          checkin_method: v.checkinMethod,
          visited_at:     v.visitedAt,
        })),
        total_count: count,
      };
    }

    // ── totals 整形 ──
    const totalsMap: Record<string, number> = {};
    for (const row of eventTypeGroups) totalsMap[row.eventType] = row._count._all;
    const pageViewCount = totalsMap["page_view"] ?? 0;
    const buttonClickCount = totalsMap["button_click"] ?? 0;
    const ctr = pageViewCount > 0 ? buttonClickCount / pageViewCount : 0;

    // checkin 系は pageId-less で保存される (location 起点) ため、default ページのときだけ
    // work 単位で別途集計し、totals に反映する。
    // default 以外のページでは 0 表示にし、UI 側でも該当カードを出さない。
    let checkinSuccessCount = 0;
    let checkinFailedCount  = 0;
    if (page.pageType === "default") {
      const [success, failed] = await Promise.all([
        prisma.liffEventLog.count({ where: { workId: work.id, eventType: "checkin_success" } }),
        prisma.liffEventLog.count({ where: { workId: work.id, eventType: "checkin_failed" } }),
      ]);
      checkinSuccessCount = success;
      checkinFailedCount  = failed;
    }

    return ok({
      work_id:        work.id,
      work_public_id: work.publicId,
      page_id:        page.id,
      page_public_id: page.publicId,
      page_type:      page.pageType,
      totals: {
        page_view:        pageViewCount,
        unique_users:     uniqueUsers,
        button_click:     buttonClickCount,
        hint_open:        totalsMap["hint_open"] ?? 0,
        faq_open:         totalsMap["faq_open"] ?? 0,
        survey_submit:    totalsMap["survey_submit"] ?? 0,
        checkin_success:  checkinSuccessCount,
        checkin_failed:   checkinFailedCount,
        ctr,
      },
      block_breakdown: blockBreakdown.map((b) => ({
        block_id:    b.liffPageBlockId,
        event_type:  b.eventType,
        count:       b._count._all,
      })),
      recent_events: recentEvents.map((e) => ({
        id:               e.id,
        event_type:       e.eventType,
        line_user_id:     e.lineUserId,
        liff_page_block_id: e.liffPageBlockId,
        metadata_json:    e.metadataJson,
        created_at:       e.createdAt,
      })),
      ...(surveyResponses && {
        survey: {
          total_count: surveyResponseCount,
          recent:      surveyResponses,
        },
      }),
      ...(checkinSummary && { checkin: checkinSummary }),
    });
  } catch (err) {
    return serverError(err);
  }
});
