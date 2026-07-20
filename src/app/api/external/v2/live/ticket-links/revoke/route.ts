// POST /api/external/v2/live/ticket-links/revoke
//   v2 = 匿名予約モデル専用。匿名連携（ウズプロCMS）の予約枠に紐づく有効なチケットリンクトークンをすべて失効する。
//   認証: requireExternalWriteApiKey（x-whale-api-key ↔ WHALE_EXTERNAL_WRITE_API_KEY）＋ OA allowlist。
//
//   冪等: すでに失効済みでも成功（既存の revokedAt は上書きせず履歴を破壊しない = revokedAt:null のみ更新）。
//   テナント安全: oaId / workId を必ず条件に含め、別 OA・別 work のトークンは失効できない。
//   LiveTeam / LiveSession / LiveParticipant は削除しない。メール / LINE 送信も行わない。

import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { requireExternalWriteApiKey } from "@/lib/external-auth";
import { revokeAnonymousBookingTokens } from "@/lib/live-ticket-mint";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    workId:             z.string().min(1).max(100),
    externalSessionRef: z.string().min(1).max(200),
    externalBookingRef: z.string().min(1).max(200),
  })
  .strict();

export async function POST(req: NextRequest) {
  const auth = requireExternalWriteApiKey(req);
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  try {
    const data = bodySchema.parse(await req.json());

    const work = await prisma.work.findUnique({ where: { id: data.workId }, select: { id: true, oaId: true } });
    if (!work) return notFound("作品");
    if (!scope.allowsOa(work.oaId)) return notFound("作品");

    // includeExpired=true: 未失効のトークンをすべて失効（期限切れ含む）。冪等（0 件でも成功）。
    const revoked = await revokeAnonymousBookingTokens(prisma, {
      oaId:               work.oaId,
      workId:             work.id,
      externalSessionRef: data.externalSessionRef,
      externalBookingRef: data.externalBookingRef,
      includeExpired:     true,
    });

    return ok({ revoked });
  } catch (err) {
    if (err instanceof ZodError) return badRequest(err.errors[0]?.message ?? "入力が不正です");
    return serverError(err);
  }
}
