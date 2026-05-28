"use client";

// src/app/admin/live/page.tsx
// Whale Studio Live 有効化管理（platform admin 専用）。
// /admin/layout.tsx で既に platform owner 認可が掛かっているため、本ページに追加ガードは不要。
// OA 一覧 + Live ON/OFF トグル。API は GET/PATCH /api/admin/oa-entitlements。

import { useEffect, useState } from "react";
import Link from "next/link";
import { getDevToken } from "@/lib/api-client";

interface OaLiveRow {
  oa_id:        string;
  title:        string;
  live_enabled: boolean;
  /** 現ユーザー（platform admin）がこの OA のメンバーか。通常設定への導線出し分けに使う。 */
  has_access:   boolean;
}

export default function AdminLivePage() {
  const [rows,    setRows]    = useState<OaLiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [busyId,  setBusyId]  = useState<string | null>(null);
  const [query,   setQuery]   = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/oa-entitlements", {
        headers: { Authorization: `Bearer ${getDevToken()}` },
      });
      if (!res.ok) throw new Error("一覧の取得に失敗しました");
      const json = await res.json();
      setRows(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggle(row: OaLiveRow) {
    if (busyId) return;
    const nextEnabled = !row.live_enabled;
    setBusyId(row.oa_id);
    // 楽観的更新
    setRows((prev) => prev.map((r) => (r.oa_id === row.oa_id ? { ...r, live_enabled: nextEnabled } : r)));
    try {
      const res = await fetch("/api/admin/oa-entitlements", {
        method:  "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${getDevToken()}`,
        },
        body: JSON.stringify({ oa_id: row.oa_id, enabled: nextEnabled }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.message || "更新に失敗しました");
      }
    } catch (e) {
      // ロールバック
      setRows((prev) => prev.map((r) => (r.oa_id === row.oa_id ? { ...r, live_enabled: row.live_enabled } : r)));
      alert(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setBusyId(null);
    }
  }

  const filtered = query.trim()
    ? rows.filter((r) =>
        r.title.toLowerCase().includes(query.trim().toLowerCase()) ||
        r.oa_id.includes(query.trim()),
      )
    : rows;

  if (loading) return <div style={{ padding: 24 }}>読み込み中…</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Whale Studio Live 管理</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            OA ごとに Whale Studio Live（上位機能）の有効 / 無効を切り替えます。無効化は物理削除せず enabled=false で保持します。
          </p>
        </div>
      </div>

      {error && (
        <div style={{
          padding: "10px 14px", marginBottom: 16,
          border: "1px solid #fecaca", background: "#fef2f2",
          color: "#dc2626", borderRadius: 6, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="OA 名 / OA ID で絞り込み"
        className="form-input"
        style={{ maxWidth: 320, marginBottom: 16 }}
      />

      {filtered.length === 0 ? (
        <div style={{ padding: 24, color: "#6b7280", fontSize: 13 }}>該当する OA がありません。</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>OA 名</th>
                <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>OA ID</th>
                <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>Whale Studio Live</th>
                <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, color: "#6b7280" }}>設定</th>
                <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11, color: "#6b7280" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.oa_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "12px 12px", fontWeight: 600 }}>{r.title}</td>
                  <td style={{ padding: "12px 12px", fontSize: 11, color: "#6b7280", wordBreak: "break-all" }}>{r.oa_id}</td>
                  <td style={{ padding: "12px 12px" }}>
                    <span style={{
                      display: "inline-flex", padding: "2px 9px", borderRadius: 999,
                      fontSize: 11, fontWeight: 700,
                      background: r.live_enabled ? "#dcfce7" : "var(--gray-100, #f3f4f6)",
                      color:      r.live_enabled ? "#166534" : "#6b7280",
                    }}>
                      {r.live_enabled ? "有効" : "無効"}
                    </span>
                  </td>
                  {/* 通常設定への導線は、現ユーザーがこの OA のメンバーである場合のみ。
                      platform admin でもメンバーでなければ /oas/[id]/settings は access-denied になるため、
                      押せる導線を出さず「メンバー外」と補足する。 */}
                  <td style={{ padding: "12px 12px", fontSize: 12 }}>
                    {r.has_access ? (
                      <Link
                        href={`/oas/${r.oa_id}/settings`}
                        style={{ color: "#2563eb", textDecoration: "none" }}
                      >
                        設定を開く ↗
                      </Link>
                    ) : (
                      <span
                        style={{ color: "#9ca3af" }}
                        title="このアカウントのメンバーではないため、通常の設定画面は開けません"
                      >
                        このOAのメンバーではありません
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "12px 12px", textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => toggle(r)}
                      disabled={busyId !== null}
                      className={r.live_enabled ? "btn btn-ghost" : "btn btn-primary"}
                      style={{ padding: "4px 14px", fontSize: 12 }}
                    >
                      {r.live_enabled ? "無効化する" : "有効化する"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
