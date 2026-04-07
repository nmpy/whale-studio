"use client";

// src/app/admin/audience/page.tsx
// ユーザー概況（OA横断）— 近日公開

import { useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/api-client";

interface OaStats {
  id: string;
  title: string;
  total_players: number;
  active_players: number;
  works_count: number;
}

export default function AdminAudiencePage() {
  const [stats,   setStats]   = useState<OaStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // /api/oas から全 OA + 作品数を取得（プラットフォームオーナーは全件返る）
    fetch("/api/oas?limit=100", {
      headers: { ...getAuthHeaders() },
    })
      .then((r) => r.json())
      .then((j) => {
        const items = (j.data ?? []) as { id: string; title: string; _count?: { works: number } }[];
        setStats(
          items.map((oa) => ({
            id:             oa.id,
            title:          oa.title,
            total_players:  0, // TODO: UserProgress 集計
            active_players: 0,
            works_count:    oa._count?.works ?? 0,
          }))
        );
      })
      .catch(() => setStats([]))
      .finally(() => setLoading(false));
  }, []);

  const totalOas     = stats.length;
  const totalWorks   = stats.reduce((s, o) => s + o.works_count, 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h2>ユーザー概況</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            全 OA のプレイヤー数・作品数のサマリー
          </p>
        </div>
      </div>

      {/* サマリーカード */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        {[
          { label: "総 OA 数",  value: totalOas,   color: "#6366f1" },
          { label: "総作品数",  value: totalWorks,  color: "#0ea5e9" },
        ].map((s) => (
          <div key={s.label} style={{
            flex: "0 0 auto", width: 140,
            padding: "14px 18px",
            background: "var(--surface)",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-md)",
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>
              {loading ? "—" : s.value}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* テーブル */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table-compact" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>アカウント名</th>
                <th style={{ textAlign: "center" }}>作品数</th>
                <th style={{ textAlign: "center" }}>プレイヤー数 *</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px" }}>
                    読み込み中...
                  </td>
                </tr>
              ) : stats.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px" }}>
                    データがありません
                  </td>
                </tr>
              ) : stats.map((oa) => (
                <tr key={oa.id}>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{oa.title}</td>
                  <td style={{ textAlign: "center" }}>{oa.works_count}</td>
                  <td style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>近日公開</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted)", padding: "8px 16px 12px" }}>
          * プレイヤー数の集計機能は近日公開予定です
        </p>
      </div>
    </>
  );
}
