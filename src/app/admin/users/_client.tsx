"use client";

// src/app/admin/users/_client.tsx
// ユーザー一覧（platform admin 専用）。GET /api/admin/users を叩いて表示する。
// データソース: Supabase Auth（作成日時/最終ログイン/provider/email/avatar）+ DB(Profile/OA/Work)。
// 個人情報（email 等）は本管理画面のみ。IP/UA/位置/行動ログは扱わない。

import { useCallback, useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import type { UsageType } from "@/lib/usage-type";

interface OwnedOa {
  id: string;
  title: string;
  usage_type: string; // "personal" | "business"（既存データは default personal）
}

interface AdminUserRow {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  full_name: string | null;
  company_name: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  oa_count: number;
  work_count: number;
  owned_oas: OwnedOa[];
}

type Sort = "created_desc" | "created_asc" | "login_desc" | "login_asc";

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "created_desc", label: "作成日時が新しい順" },
  { value: "created_asc",  label: "作成日時が古い順" },
  { value: "login_desc",   label: "最終ログインが新しい順" },
  { value: "login_asc",    label: "最終ログインが古い順" },
];

/** ISO → JST "YYYY/MM/DD HH:mm"。null/不正は「未取得」。 */
function fmtJst(iso: string | null): string {
  if (!iso) return "未取得";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "未取得";
  const s = d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  // ja-JP は "2026/06/15 18:42" 形式。
  return s.replace(/ /g, " ");
}

const td: React.CSSProperties = { padding: "8px 10px", fontSize: 12, verticalAlign: "top", borderBottom: "1px solid var(--border-light)" };
const th: React.CSSProperties = { padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textAlign: "left", borderBottom: "2px solid var(--border-light)", whiteSpace: "nowrap" };
const muted: React.CSSProperties = { color: "var(--text-muted)" };
const truncate: React.CSSProperties = { maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function Avatar({ src, name }: { src: string | null; name: string | null }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={28} height={28} style={{ borderRadius: "50%", objectFit: "cover", display: "block" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
  }
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--color-bg-subtle,#eee)", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
      {initial}
    </div>
  );
}

export function AdminUsersClient() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>("created_desc");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  // 対象アカウントの利用区分（個人/法人）編集モーダル。
  const [editUser, setEditUser] = useState<AdminUserRow | null>(null);

  // 検索はデバウンス（入力 400ms 後に確定）。
  useEffect(() => {
    const t = setTimeout(() => { setQ(searchInput.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q, sort, page: String(page), per_page: "50" });
      const res = await fetch(`/api/admin/users?${params.toString()}`, { headers: { ...getAuthHeaders() }, cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j?.error?.message ?? "読み込みに失敗しました"); setRows([]); return; }
      const d = j.data;
      setRows(Array.isArray(d?.items) ? d.items : []);
      setTotal(d?.total ?? 0);
      setTotalPages(d?.total_pages ?? 1);
      setConfigured(d?.supabase_configured !== false);
    } catch {
      setError("通信エラーが発生しました"); setRows([]);
    } finally {
      setLoading(false);
    }
  }, [q, sort, page]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4, color: "var(--text-primary)" }}>ユーザー</h1>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
        Whale Studio にログインしたユーザーの作成日時・登録情報・最終ログイン日時を確認できます。
      </p>

      {/* 検索 + 並び替え */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="名前・氏名・会社名・メールアドレス・ユーザーIDで検索"
          style={{ flex: "1 1 280px", minWidth: 220, padding: "8px 12px", border: "1px solid var(--border-light)", borderRadius: 8, fontSize: 13 }}
        />
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value as Sort); setPage(1); }}
          style={{ padding: "8px 12px", border: "1px solid var(--border-light)", borderRadius: 8, fontSize: 13, background: "#fff" }}
        >
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {!configured && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400e", marginBottom: 12 }}>
          Supabase の管理APIが未設定のため、ユーザー情報を取得できませんでした（SUPABASE_SERVICE_ROLE_KEY 未設定）。
        </div>
      )}
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#991b1b", marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
        {loading ? "読み込み中…" : `${total} 件`}
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--border-light)", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead>
            <tr>
              <th style={th}>ユーザー</th>
              <th style={th}>氏名</th>
              <th style={th}>会社名</th>
              <th style={th}>作成日時</th>
              <th style={th}>最終ログイン</th>
              <th style={{ ...th, textAlign: "right" }}>OA数</th>
              <th style={{ ...th, textAlign: "right" }}>作品数</th>
              <th style={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows && rows.length === 0 && !loading && (
              <tr><td style={{ ...td, textAlign: "center", color: "var(--text-muted)", padding: "28px" }} colSpan={8}>該当するユーザーがいません。</td></tr>
            )}
            {(rows ?? []).map((r) => (
              <tr key={r.id}>
                <td style={td}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <Avatar src={r.image} name={r.name} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, ...truncate }}>{r.name ?? <span style={muted}>未取得</span>}</div>
                      <div style={{ ...truncate, ...muted, fontSize: 11 }}>{r.email ?? "未取得"}</div>
                      <div style={{ ...truncate, ...muted, fontSize: 10, fontFamily: "monospace" }} title={r.id}>{r.id}</div>
                    </div>
                  </div>
                </td>
                <td style={td}>
                  {r.full_name ? <div style={truncate}>{r.full_name}</div> : <span style={muted}>未取得</span>}
                </td>
                <td style={td}>
                  {r.company_name ? <div style={truncate}>{r.company_name}</div> : <span style={muted}>未取得</span>}
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtJst(r.created_at)}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtJst(r.last_sign_in_at)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{r.oa_count}</td>
                <td style={{ ...td, textAlign: "right" }}>{r.work_count}</td>
                <td style={td}>
                  {r.owned_oas.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setEditUser(r)}
                      style={{ padding: "5px 12px", border: "1px solid var(--border-light)", borderRadius: 8, background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      利用区分を編集
                    </button>
                  ) : (
                    <span style={{ ...muted, fontSize: 11 }} title="所有アカウントがないため変更できません">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ページネーション */}
      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 16 }}>
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={{ padding: "6px 12px", border: "1px solid var(--border-light)", borderRadius: 8, background: "#fff", fontSize: 12, cursor: page <= 1 ? "not-allowed" : "pointer", opacity: page <= 1 ? 0.5 : 1 }}>前へ</button>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            style={{ padding: "6px 12px", border: "1px solid var(--border-light)", borderRadius: 8, background: "#fff", fontSize: 12, cursor: page >= totalPages ? "not-allowed" : "pointer", opacity: page >= totalPages ? 0.5 : 1 }}>次へ</button>
        </div>
      )}

      {editUser && (
        <UsageTypeEditModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={(oaId, next) => {
            // 一覧の当該 OA の利用区分をローカル更新しつつ、サーバから再取得して整合させる。
            setRows((prev) => prev?.map((r) => ({
              ...r,
              owned_oas: r.owned_oas.map((o) => (o.id === oaId ? { ...o, usage_type: next } : o)),
            })) ?? prev);
            showToast("対象アカウントの利用区分を変更しました", "success");
            setEditUser(null);
            void load();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}
    </div>
  );
}

/** 対象アカウント（OA）の利用区分（個人/法人）を変更するモーダル。
 *  ※ ユーザーの所属先は変更しない（membership は OA 単位のため安全側）。変更対象は選んだ OA の usageType。 */
function UsageTypeEditModal({
  user, onClose, onSaved, onError,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onSaved: (oaId: string, next: UsageType) => void;
  onError: (msg: string) => void;
}) {
  const [oaId, setOaId] = useState<string>(user.owned_oas[0]?.id ?? "");
  const currentOa = user.owned_oas.find((o) => o.id === oaId);
  const [usageType, setUsageType] = useState<UsageType>(
    (currentOa?.usage_type === "business" ? "business" : "personal"),
  );
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  // 対象アカウント切替時は、その OA の現在の利用区分を初期選択にする。
  function selectOa(nextId: string) {
    setOaId(nextId);
    const oa = user.owned_oas.find((o) => o.id === nextId);
    setUsageType(oa?.usage_type === "business" ? "business" : "personal");
    setConfirming(false);
  }

  const changed = (currentOa?.usage_type ?? "personal") !== usageType;

  async function save() {
    if (!oaId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/oas/${oaId}/usage-type`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ usage_type: usageType }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j?.error?.message ?? "変更に失敗しました"); return; }
      onSaved(oaId, usageType);
    } catch {
      onError("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-label="対象アカウントの利用区分を編集"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 20, width: "100%", maxWidth: 440, boxShadow: "0 12px 40px rgba(0,0,0,0.2)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, color: "var(--text-primary)" }}>対象アカウントの利用区分</h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
          対象ユーザー: <strong>{user.name ?? user.email ?? user.id}</strong>
        </p>

        {/* 対象アカウント（このユーザーが owner の OA から選択。所属先の変更ではない）*/}
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>対象アカウント</label>
        <select
          value={oaId}
          onChange={(e) => selectOa(e.target.value)}
          disabled={saving}
          style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border-light)", borderRadius: 8, fontSize: 13, background: "#fff", marginBottom: 16 }}
        >
          {user.owned_oas.map((o) => (
            <option key={o.id} value={o.id}>{o.title}（現在: {o.usage_type === "business" ? "法人" : "個人"}）</option>
          ))}
        </select>

        {/* 利用区分（個人/法人）*/}
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>このアカウントの利用区分</label>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          {(["personal", "business"] as const).map((v) => {
            const active = usageType === v;
            return (
              <label key={v} style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "10px 12px", borderRadius: 10, cursor: saving ? "default" : "pointer",
                border: active ? "2px solid var(--color-brand,#22c55e)" : "1.5px solid var(--border-light)",
                background: active ? "var(--color-brand-soft,#e9f8ef)" : "#fff",
                fontWeight: active ? 700 : 500, fontSize: 13,
              }}>
                <input type="radio" name="usage-type" value={v} checked={active} disabled={saving}
                  onChange={() => { setUsageType(v); setConfirming(false); }} style={{ display: "none" }} />
                {v === "business" ? "法人" : "個人"}
              </label>
            );
          })}
        </div>

        <p style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 16, background: "var(--color-bg-subtle,#f8fafc)", border: "1px solid var(--border-light)", borderRadius: 8, padding: "8px 10px" }}>
          この変更は対象アカウント全体に適用されます。料金プラン画面の表示（個人利用プラン / 法人利用プラン）や法人/個人の扱いに反映されます。
        </p>

        {confirming ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#b45309" }}>
              「{currentOa?.title}」の利用区分を「{usageType === "business" ? "法人" : "個人"}」に変更しますか？
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setConfirming(false)} disabled={saving}
                style={{ padding: "8px 14px", border: "1px solid var(--border-light)", borderRadius: 8, background: "#fff", fontSize: 13, cursor: "pointer" }}>やめる</button>
              <button type="button" onClick={save} disabled={saving}
                style={{ padding: "8px 16px", border: "none", borderRadius: 8, background: "var(--color-brand,#22c55e)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}>
                {saving ? "変更中…" : "変更する"}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose} disabled={saving}
              style={{ padding: "8px 14px", border: "1px solid var(--border-light)", borderRadius: 8, background: "#fff", fontSize: 13, cursor: "pointer" }}>閉じる</button>
            <button type="button" onClick={() => setConfirming(true)} disabled={saving || !oaId || !changed}
              title={!changed ? "現在の利用区分と同じです" : undefined}
              style={{ padding: "8px 16px", border: "none", borderRadius: 8, background: changed ? "var(--color-brand,#22c55e)" : "#cbd5e1", color: "#fff", fontSize: 13, fontWeight: 700, cursor: changed ? "pointer" : "not-allowed" }}>
              保存
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
