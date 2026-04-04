// GET /api/invitations/:token — 招待トークン検証（認証不要・公開エンドポイント）
//
// 招待受け入れページ（/invite/[token]）がレンダリング前に呼び出す。
//
// レスポンス設計:
//   - 404:     トークンが存在しない → ページは "invalid" 状態へ
//   - 200:     常に invitation の詳細を返す。以下のフラグで状態を伝える:
//       is_expired:    有効期限切れ（ページは "expired" 状態へ）
//       is_accepted:   受け入れ済み（ページは "invalid" 状態へ）
//       is_registered: 招待メールが app_activity_logs に存在（"登録済み未ログイン" 判定用）
//
// 注意: expired / accepted でも 200 を返す（410 は使わない）。
//   HTTP ステータスでなくフラグでクライアントが状態を判定するほうが堅牢。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  try {
    const invitation = await prisma.invitation.findUnique({
      where:   { token: params.token },
      include: { oa: { select: { id: true, title: true } } },
    });

    if (!invitation) return notFound("招待");

    const now         = new Date();
    const is_expired  = invitation.expiresAt < now;
    const is_accepted = invitation.acceptedAt !== null;

    // 招待メールが app_activity_logs に存在するか確認
    //   → true: 過去にログイン済みの既存ユーザー（ログイン画面へ誘導）
    //   → false: 初回ユーザー（アカウント登録フォームへ誘導）
    const activityLog = await prisma.appActivityLog.findFirst({
      where:  { email: invitation.email },
      select: { userId: true },
    });

    return ok({
      id:            invitation.id,
      oa_id:         invitation.oaId,
      oa_name:       invitation.oa.title,
      email:         invitation.email,
      role:          invitation.role,
      expires_at:    invitation.expiresAt,
      created_at:    invitation.createdAt,
      is_expired,
      is_accepted,
      is_registered: activityLog !== null,
    });
  } catch (err) {
    return serverError(err);
  }
}
