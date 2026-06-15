// POST /api/invites/member/:token/accept — 招待URLを承諾して WorkspaceMember を作成
//
// 認証必須（withAuth）。ログイン済みユーザーを対象 OA のメンバーに追加する。email 一致は要求しない
// （URL を知っている人が参加できる仕様。各自が初回登録で自分の email を登録済み）。
//
// - token を hash 化して招待を検索（なければ 404）
// - revoked / expired は不可
// - 既に受諾済み: 受諾者が本人なら成功（冪等）、別人なら使用済みエラー（単発URL）
// - OA が停止中なら不可
// - 既にメンバーなら role を上書きせず成功扱い（二重追加しない）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { hashMemberInviteToken, memberInviteStatus } from "@/lib/member-invite";

export const POST = withAuth(
  async (_req: NextRequest, { params }: { params: { token: string } }, user) => {
    try {
      if (process.env.NODE_ENV === "production" && user.id === "bypass-admin") {
        return badRequest("bypass-admin ユーザーでは本番環境の招待を承諾できません");
      }

      const invite = await prisma.memberInvite.findUnique({
        where:   { tokenHash: hashMemberInviteToken(params.token) },
        include: { oa: { select: { id: true, serviceSuspendedAt: true } } },
      });
      if (!invite) return notFound("招待URL");

      const status = memberInviteStatus(invite);
      if (status === "revoked")  return badRequest("この招待URLは無効化されています");
      if (status === "expired")  return badRequest("この招待URLは有効期限が切れています");
      if (status === "accepted") {
        // 単発URL: 受諾者本人の再アクセスは成功（冪等）、別人は使用済みエラー。
        if (invite.acceptedByUserId === user.id) {
          return ok({ oa_id: invite.oaId, role: invite.role, already: true });
        }
        return badRequest("この招待URLは既に使用されています");
      }
      if (invite.oa.serviceSuspendedAt) {
        return badRequest("このアカウントは現在停止中のため参加できません");
      }

      // 既存メンバーは role を上書きしない（二重追加しない）。
      const existing = await prisma.workspaceMember.findUnique({
        where:  { workspaceId_userId: { workspaceId: invite.oaId, userId: user.id } },
        select: { id: true },
      });

      await prisma.$transaction(async (tx) => {
        if (!existing) {
          await tx.workspaceMember.create({
            data: {
              workspaceId: invite.oaId,
              userId:      user.id,
              email:       user.email ?? null,
              role:        invite.role,
              status:      "active",
              invitedBy:   invite.createdByUserId,
              invitedAt:   invite.createdAt,
              joinedAt:    new Date(),
            },
          });
        }
        // 招待URLを消費（単発）。
        await tx.memberInvite.update({
          where: { id: invite.id },
          data:  { acceptedByUserId: user.id, acceptedAt: new Date() },
        });
      });

      return ok({ oa_id: invite.oaId, role: invite.role, already: !!existing });
    } catch (err) {
      return serverError(err);
    }
  },
);
