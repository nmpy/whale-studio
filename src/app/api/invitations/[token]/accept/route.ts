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
import { createClient } from "@supabase/supabase-js";

// ── POST /api/invitations/:token/accept ──────────────
export const POST = withAuth(
  async (req: NextRequest, { params }: { params: { token: string } }, user) => {
    try {
      // ── 1. 招待トークンを取得 ──
      const invitation = await prisma.invitation.findUnique({
        where: { token: params.token },
      });
      if (!invitation) return notFound("招待");

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

      // ── 4. メールアドレス照合（bypass-admin / dev-user はスキップ） ──
      if (user.id !== "bypass-admin" && user.id !== "dev-user") {
        const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (supabaseUrl && supabaseAnonKey) {
          const authHeader = req.headers.get("authorization") ?? "";
          const cookieHeader = req.headers.get("cookie") ?? "";
          // cookie から access_token を取得する（auth.ts と同じロジック）
          const token = authHeader.startsWith("Bearer ")
            ? authHeader.slice(7)
            : extractTokenFromCookie(cookieHeader);

          if (token) {
            const supabase = createClient(supabaseUrl, supabaseAnonKey, {
              auth: { persistSession: false },
            });
            const { data } = await supabase.auth.getUser(token);
            const userEmail = data.user?.email;

            if (userEmail && userEmail !== invitation.email) {
              return badRequest(
                `この招待は ${invitation.email} 宛てです。現在のアカウント（${userEmail}）では承諾できません`,
                { email: ["招待メールアドレスとログイン中のメールアドレスが一致しません"] }
              );
            }
          }
        }
      }

      // ── 5. 既存メンバーチェック ──
      const existingMember = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: invitation.oaId, userId: user.id } },
      });
      if (existingMember) {
        return conflict("すでにこのワークスペースのメンバーです");
      }

      // ── 6. トランザクション: acceptedAt 更新 + WorkspaceMember 作成 ──
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

// cookie ヘッダーから Supabase access_token を抽出するミニヘルパー
// (auth.ts の extractSupabaseTokenFromCookie と同じロジック)
function extractTokenFromCookie(cookieHeader: string): string | null {
  if (!cookieHeader) return null;
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    cookies[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }

  const chunkKeys = Object.keys(cookies)
    .filter((k) => /^sb-.+-auth-token\.\d+$/.test(k))
    .sort();

  let raw: string | null = null;
  if (chunkKeys.length > 0) {
    raw = chunkKeys.map((k) => cookies[k]).join("");
  } else {
    const singleKey = Object.keys(cookies).find((k) => /^sb-.+-auth-token$/.test(k));
    if (singleKey) raw = cookies[singleKey];
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as { access_token?: string };
    return parsed.access_token ?? null;
  } catch {
    try {
      const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8")) as { access_token?: string };
      return parsed.access_token ?? null;
    } catch {
      return null;
    }
  }
}
