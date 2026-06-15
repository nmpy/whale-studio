"use client";

// src/app/admin/users/_client.tsx
// ユーザー一覧（platform admin 専用）。GET /api/admin/users を叩いて表示する。
// データソース: Supabase Auth（作成日時/最終ログイン/provider/email/avatar）+ DB(Profile/OA/Work)。
// 個人情報（email 等）は本管理画面のみ。IP/UA/位置/行動ログは扱わない。

import { useCallback, useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/api-client";

interface AdminUserRow {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  meta_name: string | null;
  meta_avatar: string | null;
  provider: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  oa_count: number;
  work_count: number;
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
          placeholder="名前・メールアドレス・ユーザーIDで検索"
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
              <th style={th}>Supabase登録情報</th>
              <th style={th}>作成日時</th>
              <th style={th}>最終ログイン</th>
              <th style={{ ...th, textAlign: "right" }}>OA数</th>
              <th style={{ ...th, textAlign: "right" }}>作品数</th>
            </tr>
          </thead>
          <tbody>
            {rows && rows.length === 0 && !loading && (
              <tr><td style={{ ...td, textAlign: "center", color: "var(--text-muted)", padding: "28px" }} colSpan={6}>該当するユーザーがいません。</td></tr>
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
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
                    {r.provider
                      ? <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: "var(--color-bg-subtle,#eef2f5)", color: "var(--text-secondary)" }}>{r.provider}</span>
                      : <span style={{ ...muted, fontSize: 11 }}>未取得</span>}
                  </div>
                  <div style={{ ...truncate, fontSize: 11 }}>{r.meta_name ?? <span style={muted}>未取得</span>}</div>
                  <div style={{ ...truncate, ...muted, fontSize: 10 }}>{r.meta_avatar ? "avatar あり" : "avatar なし"}</div>
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtJst(r.created_at)}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtJst(r.last_sign_in_at)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{r.oa_count}</td>
                <td style={{ ...td, textAlign: "right" }}>{r.work_count}</td>
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
    </div>
  );
}
