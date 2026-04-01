"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { RoleBadge } from "@/components/PermissionGuard";
import type { Role } from "@/lib/types/permissions";
import { ROLE_LABELS, ROLE_DESCRIPTIONS, ROLES } from "@/lib/types/permissions";

interface Member {
  id:           string;
  workspace_id: string;
  user_id:      string;
  role:         Role;
  invited_by:   string | null;
  created_at:   string;
  updated_at:   string;
}

export default function MembersPage() {
  const { id: oaId }          = useParams<{ id: string }>();
  const { role, loading: roleLoading } = useWorkspaceRole(oaId);
  const { showToast }          = useToast();

  const [members, setMembers]  = useState<Member[]>([]);
  const [loading, setLoading]  = useState(true);
  const [error, setError]      = useState<string | null>(null);

  // 招待フォーム
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteRole, setInviteRole]     = useState<Role>("editor");
  const [inviting, setInviting]         = useState(false);

  const token = getDevToken();

  async function loadMembers() {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/oas/${oaId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "読み込みに失敗しました");
      setMembers(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadMembers(); }, [oaId]);

  async function handleRoleChange(member: Member, newRole: Role) {
    if (!confirm(`${member.user_id} のロールを「${ROLE_LABELS[newRole]}」に変更しますか？`)) return;
    try {
      const res  = await fetch(`/api/oas/${oaId}/members/${member.id}`, {
        method:  "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ role: newRole }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "変更に失敗しました");
      showToast("ロールを変更しました", "success");
      await loadMembers();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "変更に失敗しました", "error");
    }
  }

  async function handleDelete(member: Member) {
    if (!confirm(`${member.user_id} をメンバーから削除しますか？\nこの操作は取り消せません。`)) return;
    try {
      const res  = await fetch(`/api/oas/${oaId}/members/${member.id}`, {
        method:  "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status !== 204) {
        const json = await res.json();
        throw new Error(json.error?.message ?? "削除に失敗しました");
      }
      showToast("メンバーを削除しました", "success");
      await loadMembers();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "削除に失敗しました", "error");
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteUserId.trim()) return;
    setInviting(true);
    try {
      const res  = await fetch(`/api/oas/${oaId}/members`, {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ user_id: inviteUserId.trim(), role: inviteRole }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "追加に失敗しました");
      showToast("メンバーを追加しました", "success");
      setInviteUserId("");
      await loadMembers();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "追加に失敗しました", "error");
    } finally {
      setInviting(false);
    }
  }

  // アクセス制御: owner のみ
  if (!roleLoading && role !== "owner") {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
        <p style={{ fontWeight: 600 }}>アクセス権限がありません</p>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
          メンバー管理は owner のみ利用できます
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <nav style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>
            <Link href="/oas" style={{ color: "#6b7280" }}>アカウントリスト</Link>
            {" › "}
            <Link href={`/oas/${oaId}/settings`} style={{ color: "#6b7280" }}>設定</Link>
            {" › "}
            <span>メンバー管理</span>
          </nav>
          <h2>メンバー管理</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            このワークスペース（OA）へのアクセス権を管理します
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* ── メンバー一覧 ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>
          メンバー一覧
          {!loading && (
            <span style={{ fontSize: 12, fontWeight: 400, color: "#6b7280", marginLeft: 8 }}>
              {members.length} 人
            </span>
          )}
        </h3>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div className="skeleton" style={{ width: 40, height: 40, borderRadius: "50%" }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: "40%", height: 14, marginBottom: 6 }} />
                  <div className="skeleton" style={{ width: "20%", height: 12 }} />
                </div>
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <p style={{ color: "#9ca3af", fontSize: 13 }}>メンバーがいません</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {members.map((m, idx) => (
              <div
                key={m.id}
                style={{
                  display:       "flex",
                  alignItems:    "center",
                  gap:           12,
                  padding:       "12px 0",
                  borderBottom:  idx < members.length - 1 ? "1px solid #f0f0f0" : "none",
                  flexWrap:      "wrap",
                }}
              >
                {/* アバター仮 */}
                <div
                  style={{
                    width: 40, height: 40, borderRadius: "50%",
                    background: "#e5e7eb",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 16, fontWeight: 700, color: "#6b7280",
                    flexShrink: 0,
                  }}
                >
                  {m.user_id.slice(0, 1).toUpperCase()}
                </div>

                {/* ユーザー情報 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {m.user_id}
                  </div>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                    追加日: {new Date(m.created_at).toLocaleDateString("ja-JP")}
                    {m.invited_by && ` · 招待者: ${m.invited_by}`}
                  </div>
                </div>

                {/* ロール変更 */}
                <select
                  value={m.role}
                  onChange={(e) => handleRoleChange(m, e.target.value as Role)}
                  style={{
                    padding: "4px 8px", fontSize: 12,
                    border: "1px solid #e5e7eb", borderRadius: 6,
                    background: "#fff", cursor: "pointer",
                  }}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>

                <RoleBadge role={m.role as Role} />

                {/* 削除ボタン */}
                <button
                  className="btn btn-danger"
                  style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={() => handleDelete(m)}
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── メンバー追加 ── */}
      <div className="card">
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>メンバーを追加</h3>
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
          ユーザー ID（Supabase Auth の UUID）を入力してロールを設定します
        </p>

        <form onSubmit={handleInvite} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="user_id（例: supabase-uuid-here）"
            value={inviteUserId}
            onChange={(e) => setInviteUserId(e.target.value)}
            style={{
              flex: 1, minWidth: 220,
              padding: "8px 12px", fontSize: 13,
              border: "1px solid #e5e7eb", borderRadius: 6,
            }}
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
            style={{
              padding: "8px 10px", fontSize: 13,
              border: "1px solid #e5e7eb", borderRadius: 6,
              background: "#fff",
            }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={inviting || !inviteUserId.trim()}
          >
            {inviting ? "追加中..." : "追加"}
          </button>
        </form>

        {/* ロール説明 */}
        <div
          style={{
            marginTop: 16, padding: "12px 14px",
            background: "#f9fafb", borderRadius: 8,
            fontSize: 12, display: "flex", flexDirection: "column", gap: 6,
          }}
        >
          {ROLES.map((r) => (
            <div key={r} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <RoleBadge role={r} />
              <span style={{ color: "#6b7280", paddingTop: 1 }}>{ROLE_DESCRIPTIONS[r]}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
