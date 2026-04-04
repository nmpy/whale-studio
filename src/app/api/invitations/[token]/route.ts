// GET /api/invitations/:token — 招待トークン検証（認証不要・公開エンドポイント）
//
// 招待受け入れページ（/invite/[token]）がレンダリング前に呼び出し、
// トークンが有効かどうか・どの OA / role の招待かを返す。

import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  try {
    const invitation = await prisma.invitation.findUnique({
      where: { token: params.token },
      include: {
        oa: {
          select: { id: true, title: true },
        },
      },
    });

    if (!invitation) return notFound("招待");

    // 受け入れ済みチェック
    if (invitation.acceptedAt !== null) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code:    "INVITATION_ALREADY_ACCEPTED",
            message: "この招待はすでに承諾されています",
          },
        },
        { status: 410 }
      );
    }

    // 有効期限チェック
    if (invitation.expiresAt < new Date()) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code:    "INVITATION_EXPIRED",
            message: "この招待リンクの有効期限が切れています",
          },
        },
        { status: 410 }
      );
    }

    return ok({
      id:         invitation.id,
      oa_id:      invitation.oaId,
      oa_name:    invitation.oa.title,
      email:      invitation.email,
      role:       invitation.role,
      expires_at: invitation.expiresAt,
      created_at: invitation.createdAt,
    });
  } catch (err) {
    return serverError(err);
  }
}
