// src/app/api/oas/[id]/analytics-exclusion-candidates/route.ts
// GET   — 管理画面アクセス権を持つ登録ユーザー一覧＋各ユーザーの LINE UID 設定状態・除外状態（閲覧: viewer 以上）
// PATCH — 対象ユーザーの LINE UID を設定/解除（owner / admin のみ）
//
// 分析除外モーダルのメイン導線用。UID が紐づくユーザーはチェックボックスで除外 ON/OFF できる。
// UID 未設定ユーザーは owner/admin が UID を設定してから除外できる（誤除外防止）。
// 除外の実体は AnalyticsExcludedUser（OA 単位 lineUserId）で、元データは削除しない。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { maskLineUserId } from "@/lib/analytics-exclusion";
import { z, ZodError } from "zod";

// ── GET（閲覧: viewer 以上）──
export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  ["viewer", "tester", "editor", "admin", "owner"],
  async (_req, { params }, user) => {
    try {
      const members = await prisma.workspaceMember.findMany({
        where:  { workspaceId: params.id, status: "active" },
        select: { userId: true, role: true, email: true, lineUserId: true },
      });
      // migration 未適用でも一覧表示は落とさない（除外0件フォールバック）。
      let exclusions: Array<{ id: string; lineUserId: string; memberUserId: string | null; displayName: string | null; note: string | null }> = [];
      try {
        exclusions = await prisma.analyticsExcludedUser.findMany({ where: { oaId: params.id } });
      } catch (exErr) {
        console.warn("[api/analytics-exclusion-candidates] exclusions fetch failed (fallback: none):", exErr);
      }

      const profiles = await prisma.profile.findMany({
        where:  { userId: { in: members.map((m) => m.userId) } },
        select: { userId: true, username: true },
      });
      const nameByUser = new Map(profiles.map((p) => [p.userId, p.username]));
      const exByLineUserId = new Map(exclusions.map((e) => [e.lineUserId, e]));

      const memberRows = members.map((m) => {
        const ex = m.lineUserId ? exByLineUserId.get(m.lineUserId) ?? null : null;
        return {
          user_id:      m.userId,
          name:         nameByUser.get(m.userId) ?? m.email ?? m.userId,
          email:        m.email ?? null,
          role:         m.role,
          line_user_id: m.lineUserId ?? null,
          line_user_id_masked: m.lineUserId ? maskLineUserId(m.lineUserId) : null,
          has_uid:      !!m.lineUserId,
          excluded:     !!ex,
          exclusion_id: ex?.id ?? null,
        };
      });

      // 登録ユーザーに紐づかない手入力の除外（memberUserId=null かつ member.lineUserId と一致しないもの）。
      const memberLineIds = new Set(members.map((m) => m.lineUserId).filter(Boolean) as string[]);
      const manualExclusions = exclusions
        .filter((e) => !e.memberUserId && !memberLineIds.has(e.lineUserId))
        .map((e) => ({
          id: e.id,
          line_user_id_masked: maskLineUserId(e.lineUserId),
          display_name: e.displayName,
          note: e.note,
        }));

      return ok({
        me: user.id, // ログイン中ユーザーの userId（自分の行に「自分のLINEを連携」を出すため）
        members: memberRows,
        manual_exclusions: manualExclusions,
        excluded_count: exclusions.length,
      });
    } catch (err) {
      return serverError(err);
    }
  },
);

const patchSchema = z.object({
  user_id:      z.string().trim().min(1),
  line_user_id: z.string().trim().max(200).nullable(), // null / "" = 解除
});

// ── PATCH（UID 設定/解除: owner / admin のみ）──
export const PATCH = withRole<{ id: string }>(
  ({ params }) => params.id,
  ["admin", "owner"],
  async (req: NextRequest, { params }) => {
    try {
      const data = patchSchema.parse(await req.json());
      const member = await prisma.workspaceMember.findUnique({
        where:  { workspaceId_userId: { workspaceId: params.id, userId: data.user_id } },
        select: { userId: true },
      });
      if (!member) return notFound("メンバー");

      const nextUid = data.line_user_id && data.line_user_id.trim() ? data.line_user_id.trim() : null;
      await prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: params.id, userId: data.user_id } },
        data:  { lineUserId: nextUid },
      });
      return ok({ user_id: data.user_id, line_user_id: nextUid });
    } catch (err) {
      if (err instanceof ZodError) return badRequest("入力値が不正です");
      return serverError(err);
    }
  },
);
