// POST /api/invitations/:token/accept — 招待を承諾して WorkspaceMember を作成
//
// 認証必須（withAuth）。
// ログイン済みユーザーが自分の招待トークンを承諾する。
// - invitation.email と Supabase のユーザー email が一致しない場合はエラー
// - 既にメンバーの場合は 409 Conflict
// - acceptedAt を現在時刻で更新し、WorkspaceMember を upsert する

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, conflict, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";

// ── POST /api/invitations/:token/accept ──────────────
export const POST = withAuth(
  async (req: NextRequest, { params }: { params: { token: string } }, user) => {
    try {
      console.log(`[AcceptInvitation] START token=${params.token.slice(0, 8)}... userId=${user.id}`);

      // ── 1. 招待トークンを取得 ──
      const invitation = await prisma.invitation.findUnique({
        where: { token: params.token },
      });
      if (!invitation) {
        console.warn(`[AcceptInvitation] 404 token not found`);
        return notFound("招待");
      }

      console.log(`[AcceptInvitation] invitation found: oaId=${invitation.oaId} email=${invitation.email} role=${invitation.role} accepted=${!!invitation.acceptedAt}`);

      // ── 2. 受け入れ済みチェック ──
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

      // ── 3. 有効期限チェック ──
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

      // ── 4. メールアドレス照合 ──
      // withAuth が返す user には email が含まれる（getAuthUser → createServerClient 経由）
      // bypass-admin / dev-user は email を持たないためスキップ
      if (user.id !== "bypass-admin" && user.id !== "dev-user") {
        const userEmail = user.email;
        if (userEmail && userEmail !== invitation.email) {
          return badRequest(
            `この招待は ${invitation.email} 宛てです。現在のアカウント（${userEmail}）では承諾できません`,
            { email: ["招待メールアドレスとログイン中のメールアドレスが一致しません"] }
          );
        }
      }

      // ── 5. 既存メンバーチェック ──
      const existingMember = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: invitation.oaId, userId: user.id } },
      });
      if (existingMember) {
        console.log(`[AcceptInvitation] 409 already member: role=${existingMember.role} status=${existingMember.status}`);
        return conflict("すでにこのワークスペースのメンバーです");
      }

      // ── 6. トランザクション: acceptedAt 更新 + WorkspaceMember 作成 ──
      console.log(`[AcceptInvitation] creating membership: oaId=${invitation.oaId} userId=${user.id} role=${invitation.role}`);
      const [, member] = await prisma.$transaction([
        prisma.invitation.update({
          where: { id: invitation.id },
          data:  { acceptedAt: new Date() },
        }),
        prisma.workspaceMember.create({
          data: {
            workspaceId: invitation.oaId,
            userId:      user.id,
            email:       invitation.email,
            role:        invitation.role,
            status:      "active",
            invitedBy:   invitation.invitedBy,
            invitedAt:   invitation.createdAt,
            joinedAt:    new Date(),
          },
        }),
      ]);

      return ok({
        workspace_id: member.workspaceId,
        user_id:      member.userId,
        role:         member.role,
        status:       member.status,
        joined_at:    member.joinedAt,
        // フロントがリダイレクトできるよう oa_id を付与
        oa_id:        member.workspaceId,
      });
    } catch (err) {
      return serverError(err);
    }
  }
);

