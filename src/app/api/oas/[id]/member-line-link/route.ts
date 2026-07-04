// src/app/api/oas/[id]/member-line-link/route.ts
// POST /api/oas/:id/member-line-link — 本人用の LINE 連携ワンタイムコードを発行（本人の UID 登録のみ）。
//
//   - 本人（ログイン中の active メンバー）が自分の LINE を連携するための導線。
//     tester/viewer も「自分の UID 登録」は可能（除外 ON/OFF は不可・別 API で認可）。
//   - 発行したコードを本人が対象 OA の公式 LINE に送ると、webhook が source.userId を保存する。
//   - 既に UID 設定済みの場合は再連携不可（安全側）。

import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { createMemberLinkToken, MEMBER_LINK_PREFIX } from "@/lib/member-line-link";

export const POST = withRole<{ id: string }>(
  ({ params }) => params.id,
  ["viewer", "tester", "editor", "admin", "owner"],
  async (_req, { params }, user) => {
    try {
      const member = await prisma.workspaceMember.findUnique({
        where:  { workspaceId_userId: { workspaceId: params.id, userId: user.id } },
        select: { userId: true, status: true, lineUserId: true },
      });
      if (!member || member.status !== "active") return notFound("メンバー");

      // 既に連携済みなら再発行しない（既存 UID の上書きは owner/admin の手入力解除経由に限定）。
      if (member.lineUserId) {
        return badRequest("すでに LINE 連携済みです。再連携が必要な場合は管理者に解除を依頼してください。");
      }

      const { code, expiresAt } = await createMemberLinkToken({
        oaId:              params.id,
        workspaceMemberId: `${params.id}:${user.id}`, // 参照用（複合キー）。監査目的の識別子。
        userId:            user.id,
        now:               new Date(),
      });

      return ok({
        code,
        prefix:     MEMBER_LINK_PREFIX,
        expires_at: expiresAt.toISOString(),
        instructions: "このコードを、対象アカウントの公式 LINE にそのまま送信してください。連携が完了すると LINE UID が登録されます。",
      });
    } catch (err) {
      return serverError(err);
    }
  },
);
