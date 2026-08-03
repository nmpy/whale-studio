// POST /api/liff/works/[workId]/ticket-link/config
//   チケット連携タブの初期表示に必要な「設定 + 現在の状態」を返す。
//
//   GET ではなく POST にしている理由: LIFF アクセストークンを query string に載せると
//   アクセスログ等へ残るため、body で受け取る（トークンはレスポンス・ログへ出さない）。
//
//   返す状態は **配列**（1 ユーザーが複数予約を持てるため単一オブジェクトにしない）。
//   予約番号はマスクして返す。他ユーザーの情報は一切含めない。

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import {
  authenticateTicketLinkRequest,
  authFailureMessage,
  authFailureStatus,
} from "@/lib/ticket-link/auth";
import {
  enabledTicketTypes,
  isManualInputAvailable,
  playerFacingStatusLabel,
  PERFORMANCE_DATETIME_PENDING,
} from "@/lib/ticket-link/settings";
import { maskReservationNumber } from "@/lib/ticket-link/reservation-number";
import { isDraftExpired } from "@/lib/ticket-link/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ accessToken: z.string().max(4096).optional() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ workId: string }> }) {
  try {
    const { workId } = await ctx.params;
    const { accessToken } = bodySchema.parse(await req.json().catch(() => ({})));

    const auth = await authenticateTicketLinkRequest(prisma, {
      accessToken,
      workIdOrPublicId: workId,
    });
    if (!auth.ok) {
      return NextResponse.json(
        { success: false, error: { code: "TICKET_LINK_UNAVAILABLE", message: authFailureMessage(auth.failure) } },
        { status: authFailureStatus(auth.failure) },
      );
    }
    const { ctx: a } = auth;
    const now = new Date();

    const work = await prisma.work.findUnique({ where: { id: a.workId }, select: { title: true } });

    // 既存の連携（この LINE ユーザー × この作品）。複数予約を許容するため配列で返す。
    const links = await prisma.ticketLink.findMany({
      where: { oaId: a.oaId, workId: a.workId, lineUserId: a.lineUserId, status: { not: "REVOKED" } },
      orderBy: { confirmedAt: "desc" },
      select: {
        id: true, status: true, ticketType: true, participantCount: true,
        normalizedReservationNumber: true, confirmedAt: true,
        members: { orderBy: { memberIndex: "asc" }, select: { memberIndex: true, codeName: true } },
      },
    });

    // 再開可能なドラフト（期限内・未確定）。
    const draft = await prisma.ticketLinkDraft.findFirst({
      where: {
        oaId: a.oaId, workId: a.workId, lineUserId: a.lineUserId,
        status: { in: ["RECEIVED", "NEEDS_REVIEW"] },
        step: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, step: true, status: true, expiresAt: true, confirmedPayload: true },
    });
    const resumable = draft && !isDraftExpired(draft, now) ? draft : null;
    const draftPayload = (resumable?.confirmedPayload ?? {}) as Record<string, unknown>;

    return ok({
      manualInputAvailable: isManualInputAvailable(a.settings),
      // PR2 では画像経路を公開しない（押せて動かない導線を作らない）。
      imageInputAvailable: false,
      ticketTypes: enabledTicketTypes(a.settings).map((t) => ({
        ticketTypeKey:    t.ticketTypeKey,
        ticketTypeLabel:  t.ticketTypeLabel,
        participantCount: t.participantCount,
      })),
      workTitle: work?.title ?? null,
      report: {
        enabled: a.settings.reportButtonEnabled,
        label:   a.settings.reportButtonLabel,
        // 送信本文。プレイヤー端末から liff.sendMessages で送るため必要。
        message: a.settings.reportMessage,
      },
      completionMessage: a.settings.completionMessage,
      performanceDateTimeText: PERFORMANCE_DATETIME_PENDING,
      draft: resumable
        ? {
            id: resumable.id,
            step: resumable.step,
            ticketTypeKey: typeof draftPayload.ticketTypeKey === "string" ? draftPayload.ticketTypeKey : null,
          }
        : null,
      links: links.map((l) => ({
        id: l.id,
        statusLabel: playerFacingStatusLabel(l.status),
        ticketTypeLabel: l.ticketType,
        participantCount: l.participantCount,
        // 通常表示ではマスクする（全桁は確認画面のみ）。
        reservationNumberMasked: maskReservationNumber(l.normalizedReservationNumber),
        codeNames: l.members.map((m) => m.codeName),
        confirmedAt: l.confirmedAt.toISOString(),
      })),
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("リクエスト内容が不正です");
    console.error("[ticket-link/config] error");
    return serverError(err);
  }
}
