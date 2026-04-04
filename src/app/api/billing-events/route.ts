// src/app/api/billing-events/route.ts
// POST /api/billing-events — 課金イベントを記録する
//
// fire-and-forget で呼ばれることを想定。
// ログイン中なら userId も保存。未認証でも記録は成功させる。
//
// 書き込み先:
//   billing_events     — 集計用（event + userId のみ）
//   billing_event_logs — 詳細ログ（source / oa_id / work_id 付き）

import { withAuth } from "@/lib/auth";
import { created, serverError, badRequest } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { BILLING_EVENTS } from "@/lib/constants/billing-events";
import { trackBillingEventLog } from "@/lib/billing-events";
import { z } from "zod";

const schema = z.object({
  event:   z.enum(BILLING_EVENTS),
  // 流入元・補助情報（省略可）
  source:  z.string().max(64).nullable().optional(),
  // コンテキスト情報（省略可）
  oa_id:   z.string().nullable().optional(),
  work_id: z.string().nullable().optional(),
});

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest("イベント種別が不正です");

    const { event, source, oa_id, work_id } = parsed.data;

    // ── 集計用テーブル（billing_events）——————————————————————————
    await prisma.billingEvent.create({
      data: {
        event,
        userId: user.id ?? null,
      },
    });

    // ── 詳細ログテーブル（billing_event_logs）— fire-and-forget ——————
    trackBillingEventLog({
      userId: user.id ?? null,
      oaId:   oa_id   ?? null,
      workId: work_id ?? null,
      event,
      source: source  ?? null,
    });

    return created({ ok: true });
  } catch (err) {
    return serverError(err);
  }
});
