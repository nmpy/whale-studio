// src/app/admin/privacy-acceptances/page.tsx
//
// プライバシーポリシー同意履歴の閲覧画面 (Server Component)。
// **本ページは platform admin (= 運営者) 専用** で、workspace owner は閲覧不可。
//
// 設計方針:
//   - /admin/layout.tsx の汎用 guard (= platform owner OR workspace owner) では
//     workspace owner も通してしまうため、本ページに **追加で isPlatformOwner ガード** を
//     掛ける (= 既存 /admin/live と同方針)。
//   - 全ユーザーの個人情報 (= email 含む同意履歴) を表示するため、認可スコープを
//     最小化する設計。
//   - 一般ユーザー / workspace owner が直接アクセス → /admin にリダイレクト
//     (= /admin/layout.tsx の guard と同じ「より上位」へ戻す挙動)。
//   - 件数が増えてもまずは「最新 100 件 / acceptedAt desc」で十分。
//   - 日時は JST で「YYYY/MM/DD HH:mm」表記。
//   - **メールアドレス**: Supabase auth.users は Prisma スキーマ外のため、
//     `SUPABASE_SERVICE_ROLE_KEY` を使った Supabase Admin API (`auth.admin.getUserById`)
//     で取得する。未設定環境では `(取得不可)` を表示。
//   - ユーザー名 (= Profile.username) は Prisma で JOIN。

import { prisma } from "@/lib/prisma";
import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { isPlatformOwner } from "@/lib/platform-admin";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "プライバシー同意履歴 | スタジオ管理",
};

const LIMIT = 100;

function formatJst(d: Date): string {
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year:     "numeric",
    month:    "2-digit",
    day:      "2-digit",
    hour:     "2-digit",
    minute:   "2-digit",
  });
}

/**
 * Supabase Admin API でユーザー emails を取得する (= service role key 必須)。
 * 未設定 / 失敗時は空 Map を返してフォールバック表示する。
 */
async function fetchUserEmails(userIds: string[]): Promise<Map<string, string | null>> {
  const emailByUserId = new Map<string, string | null>();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey || userIds.length === 0) {
    return emailByUserId;
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // 必要な userId だけ admin.getUserById で並列取得 (= 100 件想定なら数秒以内)。
  // 失敗した行は null を保持し、UI 側で「(取得失敗)」表示にフォールバック。
  const results = await Promise.allSettled(
    userIds.map((id) => supabase.auth.admin.getUserById(id)),
  );
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.data?.user?.email) {
      emailByUserId.set(userIds[i], r.value.data.user.email);
    } else {
      emailByUserId.set(userIds[i], null);
    }
  });
  return emailByUserId;
}

export default async function PrivacyAcceptancesAdminPage() {
  // ── 追加 platform admin ガード ────────────────────────────────────
  // /admin/layout.tsx は platform OR workspace owner を通すため、
  // 本ページのスコープに合わせて isPlatformOwner のみに絞る。
  // 一般ユーザーは layout 側で既に /oas に弾かれているため、ここに到達するのは
  // platform admin or workspace owner のみ。workspace owner は /admin に戻す。
  const user = await getServerUser();
  if (!user || !isPlatformOwner(user.id)) {
    redirect("/admin");
  }

  const acceptances = await prisma.privacyPolicyAcceptance.findMany({
    orderBy: { acceptedAt: "desc" },
    take:    LIMIT,
    select: {
      id:                   true,
      userId:               true,
      privacyPolicyVersion: true,
      acceptedAt:           true,
      createdAt:            true,
    },
  });

  // Profile.username (= ユーザー名表示) と Supabase email を並列取得
  const userIds = [...new Set(acceptances.map((a) => a.userId))];
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

  // service role 未設定 → emails Map は空 / その場合「(取得不可)」表示を出す
  const emailFetchDisabled = emails.size === 0 && userIds.length > 0;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>プライバシー同意履歴</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            プライバシーポリシーへ同意したユーザーと日時 (= 最新 {LIMIT} 件)
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {acceptances.length === 0 ? (
          <p style={{ padding: 24, color: "#6b7280", fontSize: 14, margin: 0 }}>
            まだ同意履歴がありません。
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#374151" }}>ユーザー名</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#374151" }}>メールアドレス</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#374151" }}>user_id</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#374151" }}>同意バージョン</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#374151" }}>同意日時 (JST)</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#374151" }}>作成日時 (JST)</th>
                </tr>
              </thead>
              <tbody>
                {acceptances.map((a) => {
                  const username = profileByUserId.get(a.userId);
                  const email    = emails.get(a.userId);
                  return (
                    <tr key={a.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "10px 12px", color: "#111827" }}>
                        {username ?? <span style={{ color: "#9ca3af" }}>(未登録)</span>}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#374151" }}>
                        {email
                          ? email
                          : emailFetchDisabled
                            ? <span style={{ color: "#9ca3af" }}>(取得不可)</span>
                            : <span style={{ color: "#9ca3af" }}>(取得失敗)</span>}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#6b7280", fontFamily: "monospace", fontSize: 11 }}>
                        {a.userId}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#374151", fontFamily: "monospace" }}>
                        {a.privacyPolicyVersion}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#374151", whiteSpace: "nowrap" }}>
                        {formatJst(a.acceptedAt)}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#6b7280", whiteSpace: "nowrap" }}>
                        {formatJst(a.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {emailFetchDisabled && (
        <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 12 }}>
          メールアドレスは Supabase Admin API 経由で取得します。表示されない場合は
          Vercel env に <code>SUPABASE_SERVICE_ROLE_KEY</code> が設定されているか確認してください。
        </p>
      )}
    </>
  );
}
