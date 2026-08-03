// POST /api/liff/works/[workId]/ticket-link/confirm
//   最終確定。ここで初めて TicketLink / TicketLinkMember を作成する。
//
//   - 単一トランザクションで実行する。
//   - 再送されても同一 TicketLink を返し、TicketLinkMember を二重作成しない。
//   - DB の部分 UNIQUE 違反は 500 にせず「既存登録 / 競合」へ変換する。
//   - 競合時にプレイヤーへ返すのは「確認が必要」という状態だけ。
//     先行登録者の LINE userId / 表示名 / コードネーム / 登録日時 / レコード ID は返さない。

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import {
  authenticateTicketLinkRequest,
  authFailureMessage,
  authFailureStatus,
} from "@/lib/ticket-link/auth";
import { confirmTicketLink } from "@/lib/ticket-link/service";
import { playerFacingStatusLabel } from "@/lib/ticket-link/settings";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  accessToken: z.string().max(4096).optional(),
  draftId:     z.string().min(1).max(100),
});

/** 競合時の定型文言。予約の存在有無や他人の情報を含めない。 */
const CONFLICT_MESSAGE = "この予約番号は現在確認が必要な状態です。\n運営からの案内をお待ちください。";

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

    const outcome = await prisma.$transaction((tx) =>
      confirmTicketLink(tx, {
        draftId:     body.draftId,
        lineUserId:  a.lineUserId,
        displayName: a.displayName,
        oaId:        a.oaId,
        workId:      a.workId,
        settings:    a.settings,
        now,
      }),
    );

    switch (outcome.kind) {
      case "created":
      case "existing":
        return ok({
          ticketLinkId: outcome.ticketLinkId,
          alreadyRegistered: outcome.kind === "existing",
          statusLabel: playerFacingStatusLabel(outcome.status),
          completionMessage: a.settings.completionMessage,
          report: { enabled: a.settings.reportButtonEnabled, label: a.settings.reportButtonLabel },
        });
      case "conflict":
        // 409 だが「登録失敗」ではなく「確認が必要」として案内する。
        return NextResponse.json(
          { success: false, error: { code: "TICKET_LINK_CONFLICT", message: CONFLICT_MESSAGE } },
          { status: 409 },
        );
      case "invalid":
      default:
        return badRequest(outcome.message);
    }
  } catch (err) {
    if (err instanceof ZodError) return badRequest("リクエスト内容が不正です");
    console.error("[ticket-link/confirm] error");
    return serverError(err);
  }
}
