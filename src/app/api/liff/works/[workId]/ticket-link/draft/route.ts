// POST   /api/liff/works/[workId]/ticket-link/draft  … 手動入力を保存し確認ステップへ進める
// DELETE /api/liff/works/[workId]/ticket-link/draft  … 最初からやり直す（一時情報を消す）
//
//   ここでは **TicketLink を作らない**（本登録は confirm のみ）。
//   購入者名はドラフト内にのみ保存し、確定成功時・やり直し時に破棄する。
//   予約番号はサーバー側で再正規化・再検証し、ログ・URL へは出さない。

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import {
  authenticateTicketLinkRequest,
  authFailureMessage,
  authFailureStatus,
} from "@/lib/ticket-link/auth";
import { resolveTicketTypeByKey } from "@/lib/ticket-link/settings";
import { normalizeReservationNumber } from "@/lib/ticket-link/reservation-number";
import {
  canAdvanceStep,
  draftExpiresAt,
  isDraftExpired,
  purgeDraftPersonalData,
  type ManualDraftPayload,
} from "@/lib/ticket-link/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  accessToken: z.string().max(4096).optional(),
  /** 表示名ではなく安定キーのみを受け取る。 */
  ticketTypeKey: z.string().min(1).max(100),
  /** 確認用の名前。ドラフトにのみ保持し確定時に破棄する。 */
  purchaserName: z.string().max(100).optional().nullable(),
  reservationNumber: z.string().min(1).max(100),
});

const deleteSchema = z.object({ accessToken: z.string().max(4096).optional() });

function unavailable(auth: { failure: Parameters<typeof authFailureMessage>[0] }) {
  return NextResponse.json(
    { success: false, error: { code: "TICKET_LINK_UNAVAILABLE", message: authFailureMessage(auth.failure) } },
    { status: authFailureStatus(auth.failure) },
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ workId: string }> }) {
  try {
    const { workId } = await ctx.params;
    const body = bodySchema.parse(await req.json());

    const auth = await authenticateTicketLinkRequest(prisma, {
      accessToken: body.accessToken,
      workIdOrPublicId: workId,
      requireManualInput: true,
    });
    if (!auth.ok) return unavailable(auth);
    const a = auth.ctx;

    // 種別は現在の設定から安定キーで解決。無効化済みでは新規登録させない。
    const ticketType = resolveTicketTypeByKey(a.settings, body.ticketTypeKey);
    if (!ticketType) return badRequest("選択されたチケット種別は現在ご利用いただけません。");

    // 予約番号はサーバー側でも正規化 + 形式検証（クライアント検証だけに依存しない）。
    const normalized = normalizeReservationNumber(body.reservationNumber);
    if (!normalized) return badRequest("予約番号の形式が正しくありません。");

    const now = new Date();
    const payload: ManualDraftPayload = {
      ticketTypeKey: ticketType.ticketTypeKey,
      purchaserName: body.purchaserName?.trim() || null,
      normalizedReservationNumber: normalized,
      reservationNumberRaw: body.reservationNumber.trim(),
    };

    // 進行中ドラフトがあれば再利用（1 ユーザー 1 進行中）。無ければ作成。
    const existing = await prisma.ticketLinkDraft.findFirst({
      where: {
        oaId: a.oaId, workId: a.workId, lineUserId: a.lineUserId,
        status: { in: ["RECEIVED", "NEEDS_REVIEW"] }, step: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, step: true, status: true, expiresAt: true },
    });

    if (existing && !isDraftExpired(existing, now)) {
      if (!canAdvanceStep(existing.step, "TICKET_REVIEW")) {
        return badRequest("手順が正しくありません。最初からやり直してください。");
      }
      const updated = await prisma.ticketLinkDraft.update({
        where: { id: existing.id },
        data: {
          step: "TICKET_REVIEW",
          status: "NEEDS_REVIEW",
          confirmedPayload: payload as unknown as Prisma.InputJsonValue,
          expiresAt: draftExpiresAt(now),
        },
        select: { id: true, step: true },
      });
      return ok({ draftId: updated.id, step: updated.step, participantCount: ticketType.participantCount });
    }

    const created = await prisma.ticketLinkDraft.create({
      data: {
        oaId: a.oaId, workId: a.workId, lineUserId: a.lineUserId,
        source: "LIFF_MANUAL",
        status: "NEEDS_REVIEW",
        step: "TICKET_REVIEW",
        confirmedPayload: payload as unknown as Prisma.InputJsonValue,
        expiresAt: draftExpiresAt(now),
      },
      select: { id: true, step: true },
    });
    return ok({ draftId: created.id, step: created.step, participantCount: ticketType.participantCount });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力内容が正しくありません。");
    console.error("[ticket-link/draft] error");
    return serverError(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ workId: string }> }) {
  try {
    const { workId } = await ctx.params;
    const body = deleteSchema.parse(await req.json().catch(() => ({})));

    const auth = await authenticateTicketLinkRequest(prisma, {
      accessToken: body.accessToken,
      workIdOrPublicId: workId,
    });
    if (!auth.ok) return unavailable(auth);
    const a = auth.ctx;
    const now = new Date();

    // 自分のドラフトのみ対象（所有者条件をクエリに含める）。
    const drafts = await prisma.ticketLinkDraft.findMany({
      where: {
        oaId: a.oaId, workId: a.workId, lineUserId: a.lineUserId,
        status: { in: ["RECEIVED", "NEEDS_REVIEW"] },
      },
      select: { id: true },
    });

    for (const d of drafts) {
      await prisma.$transaction(async (tx) => {
        await purgeDraftPersonalData(tx, d.id, now);
        await tx.ticketLinkDraft.update({ where: { id: d.id }, data: { status: "EXPIRED", step: null } });
      });
    }

    return ok({ discarded: drafts.length });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("リクエスト内容が不正です");
    console.error("[ticket-link/draft:delete] error");
    return serverError(err);
  }
}
