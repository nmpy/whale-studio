// src/app/api/oas/[id]/beacons/test-fire/route.ts
// POST /api/oas/[id]/beacons/test-fire — 疑似発火テスト（platform admin 専用）
//
// 指定トリガーに対し、本番 Webhook と同じ handleBeaconEvent / resolver / sender を通して
// 疑似 beacon イベントを処理する。BeaconEventLog に isTest=true で記録される。
// 本番ユーザーへの誤爆を避けるため line_user_id は必須。replyToken は無いため push 送信になる。

import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, forbidden, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { isPlatformOwner } from "@/lib/platform-admin";
import { testBeaconFireSchema, formatZodErrors } from "@/lib/validations";
import { handleBeaconEvent, type LineBeaconEvent } from "@/lib/beacon";
import { loadBeaconMessageChain } from "@/lib/beacon-message";
import { replyToLine, pushToLine } from "@/lib/line";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

export const POST = withAuth<{ id: string; beaconId?: string }>(async (req, ctx, user) => {
  try {
    const { id: oaId } = await ctx.params;

    // 疑似発火は platform admin のみ。まず OA メンバーであること（viewer+）も確認する。
    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;
    if (!isPlatformOwner(user.id)) return forbidden();

    const body = await req.json();
    const data = testBeaconFireSchema.parse(body);

    // 対象トリガー（body.beacon_trigger_id で指定）
    const triggerId = typeof (body as Record<string, unknown>).beacon_trigger_id === "string"
      ? (body as Record<string, string>).beacon_trigger_id
      : null;
    if (!triggerId) return badRequest("beacon_trigger_id は必須です");

    const trigger = await prisma.beaconTrigger.findUnique({ where: { id: triggerId } });
    if (!trigger || trigger.oaId !== oaId) return notFound("BeaconTrigger");

    const oa = await prisma.oa.findUnique({
      where: { id: oaId },
      select: { id: true, title: true, channelAccessToken: true, serviceSuspendedAt: true, liffId: true },
    });
    if (!oa) return notFound("OA");

    const beaconType = data.beacon_type ?? "enter";
    // テスト専用 webhookEventId（重複排除と本番ログの区別に使う）。
    const webhookEventId = `test_beacon_${triggerId}_${Date.now()}`;

    const event: LineBeaconEvent = {
      type: "beacon",
      timestamp: Date.now(),
      // replyToken は付けない → push 送信になる
      source: { type: "user", userId: data.line_user_id },
      webhookEventId,
      deliveryContext: { isRedelivery: false },
      beacon: {
        hwid: trigger.hwid,
        type: beaconType,
        dm: data.dm ?? undefined,
      },
    };

    const result = await handleBeaconEvent({
      prisma,
      oa: {
        id: oa.id,
        channelAccessToken: oa.channelAccessToken,
        serviceSuspendedAt: oa.serviceSuspendedAt,
        // 疑似発火は platform admin 専用のため、プランによる制限はかけない（platform admin は常に Pro 相当）。
        planAllowed: true,
        // destination(liff) の URL 生成用。本番 webhook と同じ経路を通す。
        liffId: oa.liffId,
      },
      event,
      isTest: true,
      ignoreLimits: data.ignore_limits ?? false,
      resolveMessage: ({ messageId }) => loadBeaconMessageChain(messageId, oa.title ?? ""),
      line: {
        reply: (token, msgs) => replyToLine(token, msgs, oa.channelAccessToken),
        push:  async (uid, msgs) => { await pushToLine(uid, msgs, oa.channelAccessToken); },
      },
    });

    return ok({
      status: result.status,
      reason: result.reason ?? null,
      trigger_id: result.triggerId ?? triggerId,
      webhook_event_id: webhookEventId,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});
