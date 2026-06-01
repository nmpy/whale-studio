// src/app/api/admin/policies/acceptances/route.ts
// GET /api/admin/policies/acceptances — 利用規約 + プライバシーポリシー同意履歴 (platform admin only)
//
// 案 A (= 統合表示): TERMS と PRIVACY_POLICY を 1 つのリストに混ぜて acceptedAt desc。
// Profile.username + Supabase Admin API (email) を JOIN。
// 最新 100 件 (= LIMIT は今後 ?limit= で拡張可能 / 今回は固定)。

import { prisma } from "@/lib/prisma";
import { createClient } from "@supabase/supabase-js";
import { ok, forbidden, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

const LIMIT = 100;

async function fetchUserEmails(userIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey || userIds.length === 0) return map;

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const results = await Promise.allSettled(
    userIds.map((id) => supabase.auth.admin.getUserById(id)),
  );
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.data?.user?.email) {
      map.set(userIds[i], r.value.data.user.email);
    } else {
      map.set(userIds[i], null);
    }
  });
  return map;
}

export const GET = withAuth(async (_req, _ctx, user) => {
  if (!isPlatformOwner(user.id)) return forbidden();

  try {
    // 利用規約 + プライバシーポリシー同意履歴を並列取得 (= 各 LIMIT 件)
    const [termsRows, privacyRows] = await Promise.all([
      prisma.termsAcceptance.findMany({
        orderBy: { acceptedAt: "desc" },
        take:    LIMIT,
        select: { id: true, userId: true, termsVersion: true, acceptedAt: true, createdAt: true },
      }),
      prisma.privacyPolicyAcceptance.findMany({
        orderBy: { acceptedAt: "desc" },
        take:    LIMIT,
        select: { id: true, userId: true, privacyPolicyVersion: true, acceptedAt: true, createdAt: true },
      }),
    ]);

    // 統合行を作成 (= type / version / acceptedAt 統一形式)
    type Row = {
      kind:       "TERMS" | "PRIVACY_POLICY";
      id:         string;
      userId:     string;
      version:    string;
      acceptedAt: Date;
      createdAt:  Date;
    };
    const merged: Row[] = [
      ...termsRows.map((r) => ({
        kind:       "TERMS" as const,
        id:         r.id,
        userId:     r.userId,
        version:    r.termsVersion,
        acceptedAt: r.acceptedAt,
        createdAt:  r.createdAt,
      })),
      ...privacyRows.map((r) => ({
        kind:       "PRIVACY_POLICY" as const,
        id:         r.id,
        userId:     r.userId,
        version:    r.privacyPolicyVersion,
        acceptedAt: r.acceptedAt,
        createdAt:  r.createdAt,
      })),
    ]
      .sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime())
      .slice(0, LIMIT);

    // username + email を JOIN
    const userIds = [...new Set(merged.map((r) => r.userId))];
    const [profiles, emails] = await Promise.all([
      userIds.length === 0
        ? Promise.resolve([])
        : prisma.profile.findMany({
            where:  { userId: { in: userIds } },
            select: { userId: true, username: true },
          }),
      fetchUserEmails(userIds),
    ]);
    const profileByUserId = new Map(profiles.map((p) => [p.userId, p.username] as const));

    return ok(merged.map((r) => ({
      kind:        r.kind,
      id:          r.id,
      user_id:     r.userId,
      username:    profileByUserId.get(r.userId) ?? null,
      email:       emails.get(r.userId) ?? null,
      version:     r.version,
      accepted_at: r.acceptedAt,
      created_at:  r.createdAt,
    })), {
      total:               merged.length,
      email_fetch_enabled: emails.size > 0 || userIds.length === 0,
    });
  } catch (err) {
    return serverError(err);
  }
});
