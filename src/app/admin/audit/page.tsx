"use client";

// src/app/admin/audit/page.tsx
// 操作ログ（AdminAuditLog 一覧）

import { useEffect, useState } from "react";
import { getDevToken } from "@/lib/api-client";

interface AuditLog {
  id:          string;
  actor_id:    string;
  action:      string;
  resource:    string;
  resource_id: string | null;
  detail:      string | null;
  created_at:  string;
}

const ACTION_META: Record<string, { label: string; color: string }> = {
  create:    { label: "作成",   color: "#166534" },
  update:    { label: "更新",   color: "#1d4ed8" },
  publish:   { label: "公開",   color: "#0ea5e9" },
  unpublish: { label: "非公開", color: "#92400e" },
  delete:    { label: "削除",   color: "#dc2626" },
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

export default function AdminAuditPage() {
  const [logs,    setLogs]    = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/audit", {
      headers: { Authorization: `Bearer ${getDevToken()}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("取得に失敗しました");
        return r.json();
      })
      .then((j) => setLogs(j.data ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h2>操作ログ</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            管理者による操作の履歴
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table-compact" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>日時</th>
                <th>操作</th>
                <th>対象</th>
                <th>リソースID</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px" }}>
                    読み込み中...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px" }}>
                    ログはありません
                  </td>
                </tr>
              ) : logs.map((log) => {
                const actionMeta = ACTION_META[log.action] ?? { label: log.action, color: "#374151" };
                return (
                  <tr key={log.id}>
                    <td style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                      {formatDateTime(log.created_at)}
                    </td>
                    <td>
                      <span style={{
                        fontSize: 11, fontWeight: 700,
                        color:    actionMeta.color,
                        padding:  "2px 8px",
                        borderRadius: 4,
                        background: `${actionMeta.color}18`,
                      }}>
                        {actionMeta.label}
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>{log.resource}</td>
                    <td style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {log.resource_id ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
