// POST /api/liff/player-links/[publicCode]/bind-line
//   for UZU Pro: プレイヤー専用 LIFF を開いた LINE ユーザーを、公開コードで解決した対象プレイヤーへ紐づける。
//
// セキュリティ:
//   - 受け取るのは idToken のみ（.strict() で lineUserId/displayName/playerId/ticketId/bookingId 等は 400 拒否）。
//   - lineUserId はクライアント申告を信用せず、LINE の verify エンドポイントで検証した sub のみ使う。
//   - audience(channel id) は対象 OA の liffId プレフィックスから導出して検証。
//   - idToken 生値・完全な LINE User ID はログ/レスポンスへ出さない（監査ログはマスク値のみ）。
//   - レスポンスは client が状態判断できる最小限のみ（PII・内部ID・予約/チケット情報を返さない）。

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { serverError } from "@/lib/api-response";
import { resolveUzuProPlayerLink, bindPlayerLineUser } from "@/lib/uzupro/line-link";
import { verifyLiffIdToken, channelIdFromLiffId } from "@/lib/liff/id-token";
import { recordUzuProActivity, type UzuProAction } from "@/lib/uzupro/activity";
import { maskLineUserId } from "@/lib/mask";

export const dynamic = "force-dynamic";

const PUBLIC_CODE_RE = /^[A-Za-z0-9_-]{16,256}$/;
const bodySchema = z.object({ idToken: z.string().min(1).max(4096) }).strict();

function resp(status: number, body: Record<string, unknown>) {
  return NextResponse.json({ success: status < 400, ...body }, { status });
}

// 監査ログ（best-effort・PII 非含有: マスク UID / 理由コード / 内部ID は監査目的で可）。
async function safeActivity(a: {
  oaId: string;
  action: UzuProAction;
  playerId: string;
  bookingId: string;
  maskedUid?: string;
  reason?: string;
}) {
  try {
    await recordUzuProActivity(prisma, {
      oaId: a.oaId,
      actorUserId: null, // LIFF 公開経路（CMS ユーザーではない）
      action: a.action,
      targetType: "player",
      targetId: a.playerId,
      detail: {
        bookingId: a.bookingId,
        ...(a.maskedUid ? { lineUserMasked: a.maskedUid } : {}),
        ...(a.reason ? { reason: a.reason } : {}),
      },
    });
  } catch {
    /* noop: 監査失敗は本応答を妨げない */
  }
}

export async function POST(req: NextRequest, { params }: { params: { publicCode: string } }) {
  const code = params.publicCode ?? "";
  if (!PUBLIC_CODE_RE.test(code)) return resp(400, { status: "invalid_code" });

  try {
    const { idToken } = bodySchema.parse(await req.json());

    // 対象プレイヤーはサーバー側で公開コードから解決（クライアント申告 ID は使わない）。
    const link = await resolveUzuProPlayerLink(prisma, code);
    if (link.kind !== "ok") {
      // 存在しない/失効/期限切れ → 一般化（UI は「利用できません」）。410 Gone。
      return resp(410, { status: link.kind });
    }

    // ID トークン検証（audience = liffId プレフィックスの LINE Login チャネルID）。
    const channelId = channelIdFromLiffId(link.liffId);
    const verified = await verifyLiffIdToken(idToken, channelId);
    if (!verified.ok) {
      if (verified.reason === "missing_id_token") return resp(400, { status: "id_token_required" });
      if (verified.reason === "temporarily_unavailable" || verified.reason === "request_failed") {
        // 一時障害 = 再試行可能。ユーザーのアカウント不正扱いにしない。
        await safeActivity({ oaId: link.oaId, action: "line_link_failed", playerId: link.playerId, bookingId: link.bookingId, reason: "line_unavailable" });
        return resp(503, { status: "line_unavailable", retryable: true });
      }
      await safeActivity({ oaId: link.oaId, action: "line_link_failed", playerId: link.playerId, bookingId: link.bookingId, reason: `auth_${verified.reason}` });
      return resp(401, { status: "line_auth_failed", retryable: false });
    }

    const lineUserId = verified.lineUserId;
    const maskedUid = maskLineUserId(lineUserId);
    const result = await bindPlayerLineUser({
      linkId: link.linkId,
      playerId: link.playerId,
      bookingId: link.bookingId,
      oaId: link.oaId,
      lineUserId,
    });

    switch (result.kind) {
      case "work_disabled":
        // 書き込み直前の再検証で作品が for UZU Pro 無効だった。
        // 外部レスポンスは「利用できないリンク」に一般化（作品無効の事実・内部IDを漏らさない）。
        // status/コード は既存の公開リンク無効時仕様に統一（410 / not_found）。
        await safeActivity({ oaId: link.oaId, action: "line_link_failed", playerId: link.playerId, bookingId: link.bookingId, reason: "work_disabled" });
        return resp(410, { status: "not_found" });
      case "linked":
        await safeActivity({ oaId: link.oaId, action: "line_link_succeeded", playerId: link.playerId, bookingId: link.bookingId, maskedUid });
        return resp(200, { status: "linked" });
      case "already_linked_same":
        await safeActivity({ oaId: link.oaId, action: "line_link_idempotent", playerId: link.playerId, bookingId: link.bookingId, maskedUid });
        return resp(200, { status: "already_linked" });
      case "conflict_other_account":
        await safeActivity({ oaId: link.oaId, action: "line_link_conflict", playerId: link.playerId, bookingId: link.bookingId, reason: "other_account" });
        return resp(409, { status: "conflict_other_account", retryable: false });
      case "conflict_booking_duplicate":
        await safeActivity({ oaId: link.oaId, action: "line_link_conflict", playerId: link.playerId, bookingId: link.bookingId, reason: "booking_duplicate" });
        return resp(409, { status: "conflict_booking_duplicate", retryable: false });
    }
  } catch (err) {
    if (err instanceof ZodError) return resp(400, { status: "bad_request" });
    return serverError(err);
  }
}
