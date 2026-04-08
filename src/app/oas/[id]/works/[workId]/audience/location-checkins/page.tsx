"use client";

// src/app/oas/[id]/works/[workId]/audience/location-checkins/page.tsx
// ロケーションチェックイン分析ページ

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getDevToken } from "@/lib/api-client";
import type { LocationVisitStats, LocationVisit } from "@/types";

function authHeaders(token: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function LocationCheckinsPage() {
  const params = useParams();
  const oaId = params.id as string;
  const workId = params.workId as string;

  const [stats, setStats] = useState<LocationVisitStats | null>(null);
  const [recentVisits, setRecentVisits] = useState<(LocationVisit & { location_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getDevToken();
    const headers = authHeaders(token);

    Promise.all([
      fetch(`/api/works/${workId}/location-stats`, { headers }).then((r) => r.json()),
      // 全ロケーションの直近訪問を統合取得
      fetch(`/api/locations?work_id=${workId}`, { headers }).then((r) => r.json()),
    ])
      .then(async ([statsJson, locsJson]) => {
        if (statsJson.success) setStats(statsJson.data);
        else setError(statsJson.error?.message ?? "統計の取得に失敗しました");

        // 各ロケーションから直近5件ずつ取得して統合
        if (locsJson.success && Array.isArray(locsJson.data)) {
          const locs = locsJson.data as Array<{ id: string; name: string }>;
          const locMap = new Map(locs.map((l) => [l.id, l.name]));

          const visitPromises = locs.slice(0, 10).map((loc) =>
            fetch(`/api/locations/${loc.id}/visits?limit=5`, { headers })
              .then((r) => r.json())
              .then((json) =>
                json.success
                  ? (json.data as LocationVisit[]).map((v) => ({ ...v, location_name: locMap.get(v.location_id) }))
                  : []
              )
              .catch(() => [] as (LocationVisit & { location_name?: string })[])
          );
          const allVisits = (await Promise.all(visitPromises)).flat();
          allVisits.sort((a, b) => new Date(b.visited_at).getTime() - new Date(a.visited_at).getTime());
          setRecentVisits(allVisits.slice(0, 20));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [workId]);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb items={[
        { label: "OA一覧", href: "/oas" },
        { label: "作品", href: `/oas/${oaId}` },
        { label: "オーディエンス", href: `/oas/${oaId}/works/${workId}/audience` },
        { label: "ロケーション分析" },
      ]} />

      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>ロケーションチェックイン分析</h1>

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>読み込み中...</div>}
      {error && <div style={{ padding: 16, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, color: "#dc2626", marginBottom: 16 }}>{error}</div>}

      {!loading && stats && (
        <>
          {/* ── KPI カード ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
            <KpiCard label="総チェックイン数" value={stats.total_checkins} />
            <KpiCard label="ユニー��ユーザー" value={stats.unique_users} />
            <KpiCard label="ロケーション数" value={stats.location_count} />
            <KpiCard label="直近7日" value={stats.recent_7d_checkins} />
          </div>

          {/* ── ロケーション別集計 ── */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", marginBottom: 24 }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", fontWeight: 600, fontSize: 14, color: "#374151" }}>
              ロケーション別
            </div>
            {stats.by_location.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
                まだチェックイン履歴がありません
              </div>
            ) : (
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
                    <th style={thStyle}>ロケーション</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>チェックイン</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>ユニークユーザー</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>最終訪問</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.by_location.map((loc) => (
                    <tr key={loc.location_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={tdStyle}>
                        <Link
                          href={`/oas/${oaId}/works/${workId}/locations/${loc.location_id}`}
                          style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500 }}
                        >
                          {loc.location_name}
                        </Link>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>{loc.total_visits}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{loc.unique_users}</td>
                      <td style={{ ...tdStyle, textAlign: "right", color: "#9ca3af" }}>
                        {loc.last_visited_at ? new Date(loc.last_visited_at).toLocaleDateString("ja-JP") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── 直近の訪問履歴 ── */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", fontWeight: 600, fontSize: 14, color: "#374151" }}>
              直近のチェックイン（最大20件）
            </div>
            {recentVisits.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
                まだチェックイン履歴がありません
              </div>
            ) : (
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
                    <th style={thStyle}>日時</th>
                    <th style={thStyle}>ロケーション</th>
                    <th style={thStyle}>LINE User ID</th>
                  </tr>
                </thead>
                <tbody>
                  {recentVisits.map((v) => (
                    <tr key={v.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={tdStyle}>
                        {new Date(v.visited_at).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td style={tdStyle}>{v.location_name ?? "—"}</td>
                      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11, color: "#6b7280" }}>
                        {v.line_user_id.slice(0, 12)}...
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 20px" }}>
      <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color: "#111827" }}>{value.toLocaleString()}</p>
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontWeight: 600, color: "#6b7280", fontSize: 12 };
const tdStyle: React.CSSProperties = { padding: "10px 12px", color: "#374151" };
