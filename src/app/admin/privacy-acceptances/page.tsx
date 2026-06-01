// src/app/admin/privacy-acceptances/page.tsx
//
// プライバシーポリシー同意履歴の閲覧画面 (Server Component)。
//
// 設計方針:
//   - /admin/layout.tsx で platform owner / workspace owner ガードが既に効いているため、
//     本ページは閲覧用 Server Component として直接 prisma を引く (= 専用 API 不要)。
//   - 件数が増えてもまずは「最新 100 件 / acceptedAt desc」で十分。将来ページネーション要なら
//     既存 /admin/audit 等の pagination パターンを真似する。
//   - 日時は JST で「YYYY/MM/DD HH:mm」表記。
//   - 個人情報 (= email / username) は Profile を join して取得。
//     Profile 行が無い user (= 旧データ等) は username/メール null で表示。

import { prisma } from "@/lib/prisma";
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

export default async function PrivacyAcceptancesAdminPage() {
  // 同意履歴 (= 最新 100 件 / acceptedAt desc)
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

  // 同意ユーザーの username を Profile から join (= email は Supabase auth schema 側のため
  // Prisma からは引かない / userId のみ表示)。
  const userIds = acceptances.map((a) => a.userId);
  const profiles = userIds.length === 0
    ? []
    : await prisma.profile.findMany({
        where:  { userId: { in: userIds } },
        select: { userId: true, username: true },
      });
  const profileByUserId = new Map(profiles.map((p) => [p.userId, p.username] as const));

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
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#374151" }}>user_id</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#374151" }}>同意バージョン</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#374151" }}>同意日時 (JST)</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#374151" }}>作成日時 (JST)</th>
                </tr>
              </thead>
              <tbody>
                {acceptances.map((a) => (
                  <tr key={a.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "10px 12px", color: "#111827" }}>
                      {profileByUserId.get(a.userId) ?? <span style={{ color: "#9ca3af" }}>(未登録)</span>}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 12 }}>
        メールアドレスは Supabase auth schema にあり、Whale Studio 側 DB からは取得できないため表示していません。
        ユーザー特定が必要な場合は user_id を Supabase Dashboard で照合してください。
      </p>
    </>
  );
}
