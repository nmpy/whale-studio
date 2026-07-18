// POST /api/external/v1/live/ticket-links
//   外部チケットサイト（ESCAPE.ID 等）が予約完了メールへ埋め込む「専用 LIFF URL」を発行する。
//   認証: 既存 External API の共通ガード requireExternalApiKey（x-whale-api-key ↔ WHALE_EXTERNAL_API_KEY）を再利用。
//         対象 OA は WHALE_EXTERNAL_OA_IDS allowlist（scope.allowsOa）でテナント境界を検証する。
//   Phase 1: token 発行 + tokenHash 保存 + LIFF URL 生成のみ（LINE 連携・LiveParticipant には触れない）。
//
// セキュリティ:
//   - 平文トークンは発行レスポンスの URL に一度だけ載る。DB へは tokenHash(sha256) のみ保存。
//   - APIキー / 平文トークン / tokenHash / 購入者個人情報 はログ・レスポンスへ出さない。
//   - 再送（同一 reservationNumber への再発行）は、未失効・期限内の旧トークンを失効させてから新規発行し、
//     有効な URL が無制限に増えないようにする（平文は復元不可のため同一 URL の再返却はしない）。

import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, unprocessable, serverError } from "@/lib/api-response";
import { requireExternalApiKey } from "@/lib/external-auth";
import { getLiffIdForUrlGeneration } from "@/lib/liff/config";
import { generateTicketToken, hashTicketToken, resolveTicketExpiresAt, buildTicketLiffUrl } from "@/lib/live-ticket-link";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  workId:            z.string().min(1).max(100),
  reservationNumber: z.string().min(1).max(200),
  ticketId:          z.string().min(1).max(200).optional(),
  /** 外部指定の有効期限（日）。resolveTicketExpiresAt 側で許容上限にクランプ。 */
  expiresInDays:     z.number().int().positive().max(3650).optional(),
});

export async function POST(req: NextRequest) {
  const auth = requireExternalApiKey(req);
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  try {
    const data = bodySchema.parse(await req.json());

    // 作品 → OA を導出し、allowlist（テナント境界）を検証。
    const work = await prisma.work.findUnique({
      where: { id: data.workId },
      select: { id: true, oaId: true },
    });
    if (!work) return notFound("作品");
    if (!scope.allowsOa(work.oaId)) return notFound("作品"); // 存在秘匿のため 404 で統一

    const oa = await prisma.oa.findUnique({ where: { id: work.oaId }, select: { id: true, liffId: true } });
    if (!oa) return notFound("アカウント");
    const liffId = getLiffIdForUrlGeneration(oa);
    if (!liffId) return unprocessable("このアカウントの LIFF が未設定です", "LIFF_NOT_CONFIGURED");

    // 有効期限: 公演日時(active session の startsAt)が取れれば +3日、無ければ +30日。外部指定は上限クランプ。
    const now = new Date();
    const activeSession = await prisma.liveSession.findFirst({
      where:   { oaId: oa.id, workId: work.id, status: "active" },
      orderBy: { startsAt: "asc" },
      select:  { startsAt: true },
    });
    const expiresAt = resolveTicketExpiresAt({
      startsAt:      activeSession?.startsAt ?? null,
      requestedDays: data.expiresInDays ?? null,
      now,
    });

    const token = generateTicketToken();
    const tokenHash = hashTicketToken(token);

    // 再送安全化 + 発行を 1 トランザクションで。旧・有効トークンを失効 → 新規発行。
    const created = await prisma.$transaction(async (tx) => {
      await tx.liveTicketLinkToken.updateMany({
        where: { oaId: oa.id, workId: work.id, reservationNumber: data.reservationNumber, revokedAt: null, expiresAt: { gt: now } },
        data:  { revokedAt: now },
      });
      return tx.liveTicketLinkToken.create({
        data: {
          oaId:              oa.id,
          workId:            work.id,
          reservationNumber: data.reservationNumber,
          ticketId:          data.ticketId ?? null,
          tokenHash,
          expiresAt,
        },
        select: { id: true },
      });
    });

    return ok({
      url:           buildTicketLiffUrl(liffId, token),
      tokenRecordId: created.id,
      expiresAt:     expiresAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest(err.errors[0]?.message ?? "入力が不正です");
    return serverError(err);
  }
}
