// PUT /api/external/v2/live/sessions
//   ウズプロCMS が「匿名の公演参照（externalSessionRef）」で Whale Studio 内の LiveSession を冪等 upsert する。
//   v2 = 匿名予約モデル専用（v1 の legacy チケットリンク契約とは別バージョン。schema/挙動を共有しない）。
//   認証: write 専用ガード requireExternalWriteApiKey（x-whale-api-key ↔ WHALE_EXTERNAL_WRITE_API_KEY）+
//         WHALE_EXTERNAL_OA_IDS allowlist（scope.allowsOa）でテナント境界を検証。
//
//   個人情報（氏名・メール・チケットID・購入情報 等）は受け取らない。strict schema で未知フィールドを 400 拒否。
//   冪等: 同一 (oaId, workId, externalSessionRef) は同じ LiveSession を更新。初回 draft。
//         再送は日時のみ更新し status は据え置き（active→draft 降格・ended 再オープンをしない）。

import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { requireExternalWriteApiKey } from "@/lib/external-auth";
import { upsertExternalLiveSession } from "@/lib/live-external-session";

export const dynamic = "force-dynamic";

// strict(): 未知フィールド（PII 含む）は 400 で拒否する。
const bodySchema = z
  .object({
    workId:             z.string().min(1).max(100),
    externalSessionRef: z.string().min(1).max(200),
    startsAt:           z.string().datetime({ offset: true }),
    endsAt:             z.string().datetime({ offset: true }).nullish(),
  })
  .strict();

export async function PUT(req: NextRequest) {
  const auth = requireExternalWriteApiKey(req);
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  try {
    const data = bodySchema.parse(await req.json());

    // work → OA を導出し allowlist（テナント境界）を検証。存在秘匿のため未許可/不在は一律 404。
    const work = await prisma.work.findUnique({
      where: { id: data.workId },
      select: { id: true, oaId: true },
    });
    if (!work) return notFound("作品");
    if (!scope.allowsOa(work.oaId)) return notFound("作品");

    const session = await upsertExternalLiveSession(prisma, {
      oaId:               work.oaId,
      workId:             work.id,
      externalSessionRef: data.externalSessionRef,
      startsAt:           new Date(data.startsAt),
      endsAt:             data.endsAt ? new Date(data.endsAt) : null,
    });

    return ok({
      session: {
        id:                 session.id,
        externalSessionRef: session.externalSessionRef,
        status:             session.status,
        startsAt:           session.startsAt ? session.startsAt.toISOString() : null,
        endsAt:             session.endsAt ? session.endsAt.toISOString() : null,
      },
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest(err.errors[0]?.message ?? "入力が不正です");
    return serverError(err);
  }
}
