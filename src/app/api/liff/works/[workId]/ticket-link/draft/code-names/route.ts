// POST /api/liff/works/[workId]/ticket-link/draft/code-names
//   コードネームをドラフトへ保存し、最終確認ステップへ進める。
//   **本登録はしない**（TicketLink 作成は confirm のみ）。
//
//   入力数は「確定時の設定から解決した参加人数」と完全一致していること。
//   クライアントが送ってきた人数は信用しない。

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
import { validateCodeNames, CODE_NAME_MAX_LENGTH } from "@/lib/ticket-link/rules";
import { canAdvanceStep, isDraftExpired, type ManualDraftPayload } from "@/lib/ticket-link/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  accessToken: z.string().max(4096).optional(),
  draftId:     z.string().min(1).max(100),
  codeNames:   z.array(z.string().max(CODE_NAME_MAX_LENGTH * 2)).min(1).max(20),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ workId: string }> }) {
  try {
    const { workId } = await ctx.params;
    const body = bodySchema.parse(await req.json());

    const auth = await authenticateTicketLinkRequest(prisma, {
      accessToken: body.accessToken,
      workIdOrPublicId: workId,
      requireManualInput: true,
    });
    if (!auth.ok) {
      return NextResponse.json(
        { success: false, error: { code: "TICKET_LINK_UNAVAILABLE", message: authFailureMessage(auth.failure) } },
        { status: authFailureStatus(auth.failure) },
      );
    }
    const a = auth.ctx;
    const now = new Date();

    // 所有者・OA・Work をクエリ条件に含める（他ユーザーのドラフトは引けない）。
    const draft = await prisma.ticketLinkDraft.findFirst({
      where: { id: body.draftId, lineUserId: a.lineUserId, oaId: a.oaId, workId: a.workId },
      select: { id: true, step: true, status: true, expiresAt: true, confirmedPayload: true },
    });
    if (!draft) return badRequest("入力内容が見つかりませんでした。最初からやり直してください。");
    if (isDraftExpired(draft, now) || draft.status === "CONFIRMED") {
      return badRequest("入力内容の保持期限が切れました。最初からやり直してください。");
    }
    if (!canAdvanceStep(draft.step, "CODE_NAMES") && draft.step !== "CODE_NAMES" && draft.step !== "FINAL_REVIEW") {
      return badRequest("手順が正しくありません。最初からやり直してください。");
    }

    const payload = (draft.confirmedPayload ?? {}) as Partial<ManualDraftPayload>;
    const ticketType = resolveTicketTypeByKey(a.settings, payload.ticketTypeKey);
    if (!ticketType) return badRequest("選択されたチケット種別は現在ご利用いただけません。");

    if (body.codeNames.length !== ticketType.participantCount) {
      return badRequest("コードネームの数が正しくありません。");
    }
    const validation = validateCodeNames(body.codeNames);
    if (!validation.ok) return badRequest(validation.errors[0]?.message ?? "コードネームが正しくありません。");

    const next: ManualDraftPayload = {
      ticketTypeKey:               ticketType.ticketTypeKey,
      purchaserName:               payload.purchaserName ?? null,
      normalizedReservationNumber: payload.normalizedReservationNumber ?? "",
      reservationNumberRaw:        payload.reservationNumberRaw ?? "",
      // memberIndex の安定性のため入力順をそのまま保持する。
      codeNames:                   validation.normalized,
    };

    const updated = await prisma.ticketLinkDraft.update({
      where: { id: draft.id },
      data: { step: "FINAL_REVIEW", confirmedPayload: next as unknown as Prisma.InputJsonValue },
      select: { id: true, step: true },
    });

    return ok({
      draftId: updated.id,
      step: updated.step,
      warnings: validation.warnings.map((w) => ({ index: w.index, message: w.message })),
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力内容が正しくありません。");
    console.error("[ticket-link/draft/code-names] error");
    return serverError(err);
  }
}
