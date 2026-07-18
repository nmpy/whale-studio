// POST /api/liff/tickets/resolve
//   専用 LIFF URL のトークンから、表示用のチケット情報だけを返す（Phase 1・本人確認なし）。
//   本 API は「利用」でも「認証完了」でもない。以下は一切行わない:
//     LINE 本人確認 / LiveParticipant 作成・更新 / 友だち判定 / 定員判定 /
//     firstUsedAt・lastUsedAt 更新 / LiveEventLog 作成 / 認証済み判定 / lineUserId の受け入れ
//   期限切れ・失効トークンは常に拒否（参加者の有無を推測しない・クライアント lineUserId を信用しない）。

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { hashTicketToken, ticketTokenState, pickMatchingTeam, maskTicketId } from "@/lib/live-ticket-link";
import { getLiffIdForOa } from "@/lib/liff/config";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ token: z.string().min(16).max(256) });

/** ドメインエラー（LIFF 側で code→日本語へ変換）。内部詳細は出さない。 */
function ticketError(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const { token } = bodySchema.parse(await req.json());
    const now = new Date();
    const tokenHash = hashTicketToken(token);

    const rec = await prisma.liveTicketLinkToken.findUnique({
      where: { tokenHash },
      select: { id: true, oaId: true, workId: true, reservationNumber: true, ticketId: true, expiresAt: true, revokedAt: true, firstOpenedAt: true },
    });
    if (!rec) return ticketError("TOKEN_NOT_FOUND", "チケットが見つかりませんでした", 404);

    const state = ticketTokenState(rec, now);
    if (state === "revoked") return ticketError("TOKEN_REVOKED", "このチケットURLは無効化されています", 410);
    if (state === "expired") return ticketError("TOKEN_EXPIRED", "このチケットURLの有効期限が切れています", 410);

    // 遅延解決: 対象 OA/Work の active セッション内で LiveTeam を照合。
    const sessions = await prisma.liveSession.findMany({
      where:  { oaId: rec.oaId, workId: rec.workId, status: "active" },
      select: { id: true, name: true, startsAt: true },
    });
    if (sessions.length === 0) return ticketError("WORK_NOT_ACTIVE", "この公演はまだ受付を開始していません", 409);

    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    const teams = await prisma.liveTeam.findMany({
      where:  { liveSessionId: { in: sessions.map((s) => s.id) } },
      select: { id: true, reservationNumber: true, ticketId: true, liveSessionId: true, reservedAt: true, groupType: true },
    });

    const match = pickMatchingTeam(teams, { reservationNumber: rec.reservationNumber, ticketId: rec.ticketId });
    if (match.kind !== "ok") {
      // ambiguous / conflict は内部データ要因。ユーザーには一律「見つからない」で秘匿しつつ server log に残す。
      if (match.kind === "ambiguous" || match.kind === "conflict") {
        console.warn(`[ticket resolve] ${match.kind} tokenId=${rec.id} oa=${rec.oaId.slice(0, 8)}`);
      }
      return ticketError("TICKET_NOT_FOUND", "チケットを特定できませんでした。運営までお問い合わせください", 404);
    }

    const team = teams.find((t) => t.id === match.team.id)!;
    const session = sessionById.get(team.liveSessionId) ?? null;

    // firstOpenedAt は初回のみ・競合安全（where firstOpenedAt: null）。解決した session/team は冪等に保存。
    if (!rec.firstOpenedAt) {
      await prisma.liveTicketLinkToken.updateMany({ where: { id: rec.id, firstOpenedAt: null }, data: { firstOpenedAt: now } });
    }
    await prisma.liveTicketLinkToken.updateMany({ where: { id: rec.id }, data: { liveSessionId: team.liveSessionId, teamId: team.id } });

    const [work, oa] = await Promise.all([
      prisma.work.findUnique({ where: { id: rec.workId }, select: { title: true } }),
      // liffId は「専用 LIFF URL の path」に既に露出している公開値。Phase 2 で LIFF SDK を init するため返す。
      // 認証情報でも秘匿情報でもない（期限切れ・失効の常時拒否など Phase 1 のセキュリティ仕様は不変）。
      prisma.oa.findUnique({ where: { id: rec.oaId }, select: { liffId: true } }),
    ]);
    const scheduledAt = session?.startsAt ?? team.reservedAt ?? null;

    // 表示用の最小情報のみ（tokenHash / 生ID / reservationNumber / 生 ticketId / 個人情報 は返さない）。
    return ok({
      // 公開値のみ: 当該 OA の LIFF ID（LIFF URL に既に含まれる）。SDK 初期化用。
      liffId: getLiffIdForOa(oa),
      ticket: {
        maskedTicketId: maskTicketId(rec.ticketId ?? rec.reservationNumber),
        workTitle:      work?.title ?? "",
        sessionName:    session?.name ?? null,
        scheduledAt:    scheduledAt ? scheduledAt.toISOString() : null,
        venueName:      null, // 現行モデルに会場名フィールドなし（Phase 2 以降で拡張余地）
        groupType:      team.groupType ?? null,
        status:         "available",
      },
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest(err.errors[0]?.message ?? "入力が不正です");
    return serverError(err);
  }
}
