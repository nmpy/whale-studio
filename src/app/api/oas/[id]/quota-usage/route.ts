// src/app/api/oas/[id]/quota-usage/route.ts
// GET /api/oas/:id/quota-usage — OA の今月の LINE メッセージ使用状況（push 通数枠）を返す（viewer 以上）。
//   時間差メッセージ（予約送信 = push）の通数消費を CMS 上で可視化するためのエンドポイント。
//   channelAccessToken など機密は返さない。LINE API 取得失敗時は level="unknown" を返す。

import { withRole } from "@/lib/auth";
import { ok, serverError, notFound } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { getOaQuotaUsage } from "@/lib/line-quota";

export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  "viewer",
  async (_req, { params }) => {
    try {
      const oa = await prisma.oa.findUnique({
        where:  { id: params.id },
        select: { id: true, channelAccessToken: true },
      });
      if (!oa) return notFound("OA が見つかりません");

      const usage = await getOaQuotaUsage(oa.channelAccessToken);
      // channelAccessToken は返さない（usage サマリのみ）。
      return ok(usage);
    } catch (err) {
      return serverError(err);
    }
  },
);
