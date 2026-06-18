// POST /api/studio-invites/:token/accept — 招待URLを受諾し、対象 OA へ利用区分・ロール・プラン権限を反映
//
// 認証必須（withAuth）。ログイン済みユーザーを、招待に保存された対象 OA(invite.oaId)へ反映する。
// - token を hash 化して招待を検索（なければ 404）
// - revoked / expired / used(別人) は安全に拒否（副作用なし）
// - 期限切れ・使用済みの場合、ユーザー作成や権限付与などの副作用は一切起こさない
// - 単発URL: acceptedAt を条件付き更新で消費（同時受諾レース対策）
// - 反映: usageType → Oa.usageType / role → WorkspaceMember(降格はしない) / plan → 課金非連動の付与記録
//   ※ Stripe(subscription/price/checkout/webhook) は一切変更しない。invite 行自体が grant 記録。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { ROLE_LEVELS, type Role } from "@/lib/types/permissions";
import { hashStudioInviteToken, studioInviteState } from "@/lib/studio-invite";

// 仕様文言（期限切れ）。
const EXPIRED_MESSAGE = "登録までに一定期間を過ぎたため、権限を取得することができません。";
const USED_MESSAGE = "この招待URLはすでに使用されています。";

/** 2 つのロールのうち強い方を返す（降格防止に使う）。 */
function strongerRole(a: Role, b: Role): Role {
  return ROLE_LEVELS[a] >= ROLE_LEVELS[b] ? a : b;
}

export const POST = withAuth(
  async (_req: NextRequest, { params }: { params: { token: string } }, user) => {
    try {
      if (process.env.NODE_ENV === "production" && user.id === "bypass-admin") {
        return badRequest("bypass-admin ユーザーでは本番環境の招待を受諾できません");
      }

      const invite = await prisma.studioInvite.findUnique({
        where:   { tokenHash: hashStudioInviteToken(params.token) },
        include: { oa: { select: { id: true, ownerKey: true, serviceSuspendedAt: true } } },
      });
      if (!invite) return notFound("招待URL");

      const state = studioInviteState(invite);
      if (state === "revoked") return badRequest("この招待URLは無効化されています");
      if (state === "expired") return badRequest(EXPIRED_MESSAGE);
      if (state === "accepted") {
        // 単発URL: 受諾者本人の再アクセスは成功（冪等）、別人は使用済みエラー（副作用なし）。
        if (invite.acceptedByUserId === user.id) {
          return ok({
            oa_id:      invite.oaId,
            role:       invite.role,
            usage_type: invite.usageType,
            plan_tier:  invite.planTier,
            already:    true,
          });
        }
        return badRequest(USED_MESSAGE);
      }
      if (invite.oa.serviceSuspendedAt) {
        return badRequest("このアカウントは現在停止中のため受諾できません");
      }

      const isOwnerByKey = invite.oa.ownerKey === user.id;
      const existing = await prisma.workspaceMember.findUnique({
        where:  { workspaceId_userId: { workspaceId: invite.oaId, userId: user.id } },
        select: { id: true, role: true },
      });

      // 反映後の最終ロール（降格は一切しない）。
      let finalRole: Role;
      if (isOwnerByKey) {
        finalRole = "owner"; // ownerKey owner は member 行を作らず owner のまま維持。
      } else if (existing) {
        finalRole = strongerRole(existing.role as Role, invite.role as Role);
      } else {
        finalRole = invite.role as Role;
      }

      const now = new Date();
      let consumed = true;
      await prisma.$transaction(async (tx) => {
        // 1. 招待を消費（条件付き: 未受諾・未失効のみ）。0 件なら同時受諾されたとみなす。
        const res = await tx.studioInvite.updateMany({
          where: { id: invite.id, acceptedAt: null, revokedAt: null },
          data:  { acceptedByUserId: user.id, acceptedAt: now },
        });
        if (res.count === 0) { consumed = false; return; }

        // 2. 利用区分を対象 OA に反映。
        await tx.oa.update({ where: { id: invite.oaId }, data: { usageType: invite.usageType } });

        // 3. ロール反映（owner は降格しない / 既存より弱いロールには下げない）。
        if (!isOwnerByKey) {
          if (existing) {
            if (finalRole !== existing.role) {
              await tx.workspaceMember.update({
                where: { workspaceId_userId: { workspaceId: invite.oaId, userId: user.id } },
                data:  { role: finalRole },
              });
            }
          } else {
            await tx.workspaceMember.create({
              data: {
                workspaceId: invite.oaId,
                userId:      user.id,
                email:       user.email ?? null,
                role:        invite.role,
                status:      "active",
                invitedBy:   invite.createdByUserId,
                invitedAt:   invite.createdAt,
                joinedAt:    now,
              },
            });
          }
        }
        // 4. plan は課金非連動の付与記録（= 消費済みの invite 行が grant 記録そのもの）。
        //    Stripe subscription/price/Plan テーブルには一切書き込まない。
      });

      if (!consumed) return badRequest(USED_MESSAGE);

      return ok({
        oa_id:      invite.oaId,
        role:       finalRole,
        usage_type: invite.usageType,
        plan_tier:  invite.planTier,
        already:    !!existing,
      });
    } catch (err) {
      return serverError(err);
    }
  },
);
