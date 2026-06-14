// src/app/api/works/[workId]/x-posts/analytics/route.ts
// GET /api/works/[workId]/x-posts/analytics — 流入分析（viewer 以上）。
// PR1 の計測URLクリックログ（XPostClickEvent）を集計する。X API / スクレイピングは使わない。
//
// CV について: 現状 X投稿クリック → 作品開始/CV を紐づける attribution イベントが無いため、
// PR2 では CV数 = 0（placeholder）。将来 XPostConversionEvent 追加で実値化できる設計（cv_count 列を返す）。

import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { parseHashtagsJson } from "@/lib/x-posts/format";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ workId: string }>(async (_req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");
    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const posts = await prisma.xPost.findMany({
      where:   { oaId, workId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
    const ids = posts.map((p) => p.id);

    // ── クリック集計（N+1 回避でまとめて取得）──
    // 総数 + 最終クリック日時
    const totals = ids.length
      ? await prisma.xPostClickEvent.groupBy({
          by: ["xPostId"],
          where: { xPostId: { in: ids } },
          _count: { _all: true },
          _max: { clickedAt: true },
        })
      : [];
    const totalByPost = new Map(totals.map((t) => [t.xPostId, t._count._all]));
    const lastByPost  = new Map(totals.map((t) => [t.xPostId, t._max.clickedAt]));

    // ipHash=null のクリック数（重複排除できないため各 1 ユニーク扱い）
    const nullGroups = ids.length
      ? await prisma.xPostClickEvent.groupBy({
          by: ["xPostId"],
          where: { xPostId: { in: ids }, ipHash: null },
          _count: { _all: true },
        })
      : [];
    const nullByPost = new Map(nullGroups.map((g) => [g.xPostId, g._count._all]));

    // distinct な ipHash（非 null）件数 = ユニーク（ipHash + 投稿単位）
    const distinctRows = ids.length
      ? await prisma.xPostClickEvent.findMany({
          where: { xPostId: { in: ids }, ipHash: { not: null } },
          distinct: ["xPostId", "ipHash"],
          select: { xPostId: true },
        })
      : [];
    const distinctByPost = new Map<string, number>();
    for (const r of distinctRows) distinctByPost.set(r.xPostId, (distinctByPost.get(r.xPostId) ?? 0) + 1);

    const rows = posts.map((p) => {
      const clicks = totalByPost.get(p.id) ?? 0;
      const unique = (distinctByPost.get(p.id) ?? 0) + (nullByPost.get(p.id) ?? 0);
      const cv = 0; // placeholder（attribution 未実装）
      const last = lastByPost.get(p.id) ?? null;
      return {
        id:                 p.id,
        title:              p.title,
        body_excerpt:       (p.body ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
        x_post_url:         p.xPostUrl,
        tracking_url:       p.trackingUrl,
        hashtags:           parseHashtagsJson(p.hashtags),
        click_count:        clicks,
        unique_click_count: unique,
        cv_count:           cv,
        cvr:                clicks > 0 ? cv / clicks : null, // 0クリックは null（UIで「-」）
        last_clicked_at:    last ? last.toISOString() : null,
      };
    });

    const totalClicks = rows.reduce((s, r) => s + r.click_count, 0);
    const totalUnique = rows.reduce((s, r) => s + r.unique_click_count, 0);
    const totalCv     = rows.reduce((s, r) => s + r.cv_count, 0);
    const lastClickedAt = rows.reduce<string | null>((acc, r) => {
      if (!r.last_clicked_at) return acc;
      return !acc || r.last_clicked_at > acc ? r.last_clicked_at : acc;
    }, null);

    const summary = {
      post_count:            posts.length,
      tracking_issued_count: posts.filter((p) => !!p.trackingCode).length,
      total_clicks:          totalClicks,
      total_unique_clicks:   totalUnique,
      total_cv:              totalCv,
      avg_cvr:               totalClicks > 0 ? totalCv / totalClicks : null,
      last_clicked_at:       lastClickedAt,
    };

    // CVRランキング（上位5件）。CVR降順 → クリック数降順。null CVR は末尾。
    const ranking = [...rows]
      .sort((a, b) => {
        const av = a.cvr ?? -1, bv = b.cvr ?? -1;
        if (bv !== av) return bv - av;
        return b.click_count - a.click_count;
      })
      .slice(0, 5)
      .map((r, i) => ({
        rank: i + 1, id: r.id, title: r.title,
        cvr: r.cvr, cv_count: r.cv_count, click_count: r.click_count,
      }));

    return ok({ summary, rows, ranking });
  } catch (err) {
    return serverError(err);
  }
});
