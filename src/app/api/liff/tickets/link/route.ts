// POST /api/liff/tickets/link
//   専用 LIFF URL のトークンで開いたプレイヤーを、サーバー検証済みの LINE ユーザーとして
//   対象 LiveTeam へ連携する（Phase 2・本人確認あり）。
//
// フロー（§12 の順序）:
//   1. 入力検証（token / accessToken）
//   2. token を hash 化して検索
//   3. accessToken を verifyLiffAccessToken で検証（LINE api.line.me/v2/profile）
//   4. サーバー側で lineUserId を確定（クライアント申告の lineUserId は受け取らない・信用しない）
//   5. OA/work/active session/team を再解決（Phase 1 の stale ID を無条件に信用しない）
//   6. 同一 lineUserId の既連携を確認
//   7. 既連携なら 期限切れ・失効でも冪等成功（完了画面の再表示）
//   8. 新規は token 期限・失効を検証（切れていれば拒否・消費しない）
//   9. 対象 OA の bot/profile で友だち状態確認（本人確認とは分離）
//  10. 未追加なら FRIEND_REQUIRED（participant/event/日時を一切変更しない・token 有効のまま）
//  11-16. 対象 LiveTeam 行を FOR UPDATE でロックし、ロック内で 既連携再確認→定員判定(新規のみ)→
//         participant 作成→token firstUsedAt/lastUsedAt 更新→checked_in event 記録
//  18. 認証済みレスポンス
//
// セキュリティ:
//   - クライアント申告 lineUserId は本人確認に使わない。accessToken は DB/ログ/レスポンスに出さない。
//   - 検証失敗・友だ未追加・定員到達・通信失敗では token を消費せず、恒久状態を変更しない。
//   - 外部 API（本人確認・友だち確認）は **DB ロック取得前**に完了させる。

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, serverError } from "@/lib/api-response";
import { verifyLiffAccessToken } from "@/lib/liff/session";
import { hashTicketToken, ticketTokenState, pickMatchingTeam, maskTicketId } from "@/lib/live-ticket-link";
import { getOaFriendStatus, buildLineAddFriendUrl } from "@/lib/line-friend";
import { linkLineUserToResolvedLiveTeam } from "@/lib/live-participant-link";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token:       z.string().min(16).max(256),
  // 無い場合は verifyLiffAccessToken 側で missing 判定 → ACCESS_TOKEN_REQUIRED にマップする。
  accessToken: z.string().max(4096).optional(),
});

type LinkExtra = { retryable?: boolean; addFriendUrl?: string | null };

/** ドメインエラー（LIFF 側で code→日本語へ変換）。内部詳細・秘匿情報は出さない。 */
function linkError(code: string, message: string, status: number, extra?: LinkExtra) {
  const body: Record<string, unknown> = { success: false, error: { code, message } };
  if (extra?.retryable !== undefined) body.retryable = extra.retryable;
  if (extra && "addFriendUrl" in extra) body.addFriendUrl = extra.addFriendUrl ?? null;
  return NextResponse.json(body, { status });
}

/** 表示用チケット情報（生 ID / 個人情報を含めない）。 */
function ticketView(args: {
  ticketIdSource: string | null;
  workTitle: string;
  sessionName: string | null;
  scheduledAt: Date | null;
  groupType: string | null;
}) {
  return {
    maskedTicketId: maskTicketId(args.ticketIdSource),
    workTitle:      args.workTitle,
    sessionName:    args.sessionName,
    scheduledAt:    args.scheduledAt ? args.scheduledAt.toISOString() : null,
    venueName:      null as string | null,
    groupType:      args.groupType,
    status:         "linked" as const,
  };
}

export async function POST(req: NextRequest) {
  try {
    // (1) 入力検証
    const { token, accessToken } = bodySchema.parse(await req.json());
    const now = new Date();

    // (2) token を hash 化して検索
    const tokenHash = hashTicketToken(token);
    const rec = await prisma.liveTicketLinkToken.findUnique({
      where:  { tokenHash },
      select: {
        id: true, oaId: true, workId: true, origin: true, reservationNumber: true, ticketId: true,
        liveSessionId: true, teamId: true, expiresAt: true, revokedAt: true,
      },
    });
    if (!rec) return linkError("TOKEN_NOT_FOUND", "チケットが見つかりませんでした", 404);

    // (3)-(4) accessToken を検証してサーバー側で lineUserId を確定
    const verified = await verifyLiffAccessToken(accessToken);
    if (!verified.ok) {
      // 検証失敗時は token を消費しない（何も書き込まない）。理由でユーザー向けコードを分岐。
      if (verified.reason === "missing_access_token") {
        return linkError("ACCESS_TOKEN_REQUIRED", "LINE のログイン情報が取得できませんでした", 401);
      }
      if (verified.reason === "request_failed") {
        return linkError("NETWORK_ERROR", "LINE との通信に失敗しました。もう一度お試しください", 503, { retryable: true });
      }
      return linkError("ACCESS_TOKEN_INVALID", "LINE の認証に失敗しました。開き直してもう一度お試しください", 401);
    }
    const lineUserId = verified.lineUserId;
    const displayName = verified.displayName;

    const state = ticketTokenState(rec, now);

    // (6)-(7) 既連携確認 → 既連携なら期限切れ・失効でも冪等成功（完了画面の再表示）。
    //   Phase 1/2 で保存された liveSessionId を用い、active 再解決に依存せず判定する。
    if (rec.liveSessionId) {
      const existing = await prisma.liveParticipant.findFirst({
        where:  {
          liveSessionId: rec.liveSessionId,
          lineUserId,
          ...(rec.teamId ? { teamId: rec.teamId } : {}),
        },
        select: { id: true, liveSessionId: true, teamId: true },
      });
      if (existing) {
        const [work, session, team, oa] = await Promise.all([
          prisma.work.findUnique({ where: { id: rec.workId }, select: { title: true } }),
          prisma.liveSession.findUnique({ where: { id: existing.liveSessionId }, select: { name: true, startsAt: true } }),
          existing.teamId
            ? prisma.liveTeam.findUnique({ where: { id: existing.teamId }, select: { groupType: true, reservedAt: true } })
            : Promise.resolve(null),
          prisma.oa.findUnique({ where: { id: rec.oaId }, select: { lineOaId: true } }),
        ]);
        return NextResponse.json({
          success: true,
          data: {
            status: "already_linked",
            ticket: ticketView({
              ticketIdSource: rec.ticketId ?? rec.reservationNumber,
              workTitle:      work?.title ?? "",
              sessionName:    session?.name ?? null,
              scheduledAt:    session?.startsAt ?? team?.reservedAt ?? null,
              groupType:      team?.groupType ?? null,
            }),
            addFriendUrl: buildLineAddFriendUrl(oa?.lineOaId),
          },
        });
      }
    }

    // (8) 新規は期限切れ・失効を拒否（token を消費しない）。
    if (state === "revoked") return linkError("TOKEN_REVOKED", "このチケットURLは無効化されています", 410);
    if (state === "expired") return linkError("TOKEN_EXPIRED", "このチケットURLの有効期限が切れています", 410);

    // (5) 再解決: 対象 OA/Work の active セッション内で LiveTeam を再照合。
    const sessions = await prisma.liveSession.findMany({
      where:  { oaId: rec.oaId, workId: rec.workId, status: "active" },
      select: { id: true, name: true, startsAt: true },
    });
    if (sessions.length === 0) return linkError("WORK_NOT_ACTIVE", "この公演はまだ受付を開始していません", 409);

    const teams = await prisma.liveTeam.findMany({
      where:  { liveSessionId: { in: sessions.map((s) => s.id) } },
      select: { id: true, reservationNumber: true, ticketId: true, liveSessionId: true, groupType: true, reservedAt: true },
    });
    const match = pickMatchingTeam(teams, { reservationNumber: rec.reservationNumber, ticketId: rec.ticketId });
    if (match.kind !== "ok") {
      if (match.kind === "ambiguous" || match.kind === "conflict") {
        console.warn(`[ticket link] ${match.kind} tokenId=${rec.id} oa=${rec.oaId.slice(0, 8)}`);
      }
      return linkError("TICKET_NOT_FOUND", "チケットを特定できませんでした。運営までお問い合わせください", 404);
    }
    const team = teams.find((t) => t.id === match.team.id)!;

    // 解決済み teamId と現在の解決結果が矛盾する場合は安全に拒否（stale ID を信用しない）。
    if (rec.teamId && rec.teamId !== team.id) {
      console.warn(`[ticket link] stale team mismatch tokenId=${rec.id} oa=${rec.oaId.slice(0, 8)}`);
      return linkError("TICKET_NOT_FOUND", "チケットを特定できませんでした。運営までお問い合わせください", 404);
    }

    // (9)-(10) 友だち状態確認（本人確認とは分離・DB ロック前に外部 API を完了）。
    const oa = await prisma.oa.findUnique({
      where:  { id: rec.oaId },
      select: { channelAccessToken: true, lineOaId: true },
    });
    if (!oa) return linkError("TICKET_NOT_FOUND", "チケットを特定できませんでした。運営までお問い合わせください", 404);

    const friend = await getOaFriendStatus(lineUserId, oa.channelAccessToken);
    if (friend.kind === "config_error") {
      // OA の Messaging API 設定不備。ユーザーの未追加として扱わない。運用エラーとして記録。
      console.error(`[ticket link] OA line config error status=${friend.status} oa=${rec.oaId.slice(0, 8)}`);
      return linkError("OA_LINE_CONFIG_ERROR", "アカウント設定に問題があります。運営までお問い合わせください", 502, { retryable: false });
    }
    if (friend.kind === "unavailable") {
      return linkError("NETWORK_ERROR", "LINE との通信に失敗しました。もう一度お試しください", 503, { retryable: true });
    }
    if (friend.kind === "not_friend") {
      // participant / event / firstUsedAt / lastUsedAt を変更しない。token は有効のまま。
      return linkError(
        "FRIEND_REQUIRED",
        "LINE公式アカウントを友だち追加してから、もう一度お試しください",
        403,
        { retryable: true, addFriendUrl: buildLineAddFriendUrl(oa.lineOaId) },
      );
    }
    // friend.kind === "friend" → 連携続行

    // (11)-(16) 対象 team をロックしたトランザクション内で定員判定 + 連携（原子的）。
    const result = await linkLineUserToResolvedLiveTeam({
      oaId:          rec.oaId,
      liveSessionId: team.liveSessionId,
      teamId:        team.id,
      groupType:     team.groupType,
      lineUserId,
      displayName,
      tokenId:       rec.id,
      // 共有入口: origin で除外せず、解決した token.origin を Participant へ継承する。
      origin:        rec.origin,
      via:           "liff_ticket",
      now,
    });
    if (result.kind === "team_full") {
      // token / event / participant を一切変更していない（ロック内で判定・中断）。
      return linkError("TEAM_FULL", "このチケットで連携できる人数の上限に達しています", 409, { retryable: false });
    }

    // (18) 認証済みレスポンス
    const [work, session] = await Promise.all([
      prisma.work.findUnique({ where: { id: rec.workId }, select: { title: true } }),
      Promise.resolve(sessions.find((s) => s.id === team.liveSessionId) ?? null),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        status: result.created ? "linked" : "already_linked",
        ticket: ticketView({
          ticketIdSource: rec.ticketId ?? rec.reservationNumber,
          workTitle:      work?.title ?? "",
          sessionName:    session?.name ?? null,
          scheduledAt:    session?.startsAt ?? team.reservedAt ?? null,
          groupType:      team.groupType ?? null,
        }),
        addFriendUrl: buildLineAddFriendUrl(oa.lineOaId),
      },
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest(err.errors[0]?.message ?? "入力が不正です");
    return serverError(err);
  }
}
