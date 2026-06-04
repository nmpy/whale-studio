// src/app/api/live/invite/actor/route.ts
// POST /api/live/invite/actor — 演者招待 URL の受諾フロー
//
// 認可: ログイン必須 (= getAuthUser)。token を body で受け取り、tokenHash で
//       照合する。OA-scoped な authorizeLive は通さない (= 招待 token 自体が認証要素)。
//
// 副作用:
//   - 該当 LiveActorInvite.usedAt を now() に更新
//   - 該当 LiveActor.userId を受諾者の auth user id に set
//   - 既に別 user が紐付いている場合は 409 (= 競合)
//
// セキュリティ:
//   - token は body で受け取り、URL / クエリには出さない (= 受諾ボタン押下時)
//   - 失敗時は state を返して UI で適切にメッセージ表示

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { NextResponse as Res } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { hashInviteToken, inviteState } from "@/lib/live-actor-invite";

export const dynamic = "force-dynamic";

const acceptSchema = z.object({
  token: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) {
    return Res.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "ログインが必要です" } },
      { status: 401 },
    );
  }

  try {
    const { token } = acceptSchema.parse(await req.json());
    const tokenHash = hashInviteToken(token);

    const invite = await prisma.liveActorInvite.findUnique({
      where:   { tokenHash },
      include: { actor: { select: { id: true, oaId: true, userId: true, displayName: true } } },
    });
    if (!invite) {
      return Res.json(
        { success: false, error: { code: "INVALID_TOKEN", message: "招待 URL が不正です" } },
        { status: 404 },
      );
    }

    const now = new Date();
    const state = inviteState(invite, now);
    if (state !== "active") {
      // state ごとに UI で分岐できるよう、code を細分化
      const codeByState: Record<string, string> = {
        expired: "INVITE_EXPIRED",
        used:    "INVITE_USED",
        revoked: "INVITE_REVOKED",
      };
      const msgByState: Record<string, string> = {
        expired: "招待 URL の有効期限が切れています",
        used:    "この招待 URL は既に使用済みです",
        revoked: "この招待 URL は無効化されています",
      };
      return Res.json(
        {
          success: false,
          error: {
            code:    codeByState[state] ?? "INVITE_INVALID",
            message: msgByState[state] ?? "招待 URL が無効です",
            state,
          },
        },
        { status: 410 },
      );
    }

    // 既に別 user が actor に紐付いている場合は競合
    if (invite.actor.userId && invite.actor.userId !== user.id) {
      return Res.json(
        {
          success: false,
          error: {
            code:    "ACTOR_ALREADY_LINKED",
            message: "この演者は既に別のユーザーに紐付いています",
          },
        },
        { status: 409 },
      );
    }

    // 受諾を 1 トランザクションで反映
    await prisma.$transaction([
      prisma.liveActor.update({
        where: { id: invite.actorId },
        data:  { userId: user.id },
      }),
      prisma.liveActorInvite.update({
        where: { id: invite.id },
        data:  { usedAt: now },
      }),
    ]);

    return ok({
      oa_id:       invite.actor.oaId,
      actor_id:    invite.actorId,
      actor_name:  invite.actor.displayName,
      redirect_to: `/oas/${invite.actor.oaId}/live/actor`,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
