"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { oaApi, workApi, getDevToken, type OaListItem, type OaListMeta, type WorkListItem } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { RoleBadge } from "@/components/PermissionGuard";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import type { Role } from "@/lib/types/permissions";

const STATUS_LABEL: Record<string, string> = {
  draft:  "未設定",
  active: "公開中",
  paused: "停止中",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${mo}/${day}`;
}

/* ── PDFガイドバナー ──────────────────────────────────────────────────── */
function GuideBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 16,
      padding: "14px 20px",
      background: "linear-gradient(135deg, #eef6ff 0%, #f0fdf4 100%)",
      border: "1px solid #bfdbfe",
      borderLeft: "4px solid var(--color-info)",
      borderRadius: "var(--radius-md)",
      marginBottom: 20,
    }}>
      {/* アイコン */}
      <div style={{
        width: 40, height: 40,
        borderRadius: "var(--radius-sm)",
        background: "#dbeafe",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        fontSize: 20,
      }}>
        📄
      </div>

      {/* テキスト */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e40af", marginBottom: 2 }}>
          はじめての方へ — 使い方ガイド
        </div>
        <div style={{ fontSize: 12, color: "#3b82f6", lineHeight: 1.5 }}>
          セットアップ手順・LINEチャンネル連携・謎解きシナリオの作り方をまとめたPDFです。
        </div>
      </div>

      {/* ダウンロードボタン */}
      <a
        href="/guide.pdf"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 16px",
          background: "#2563eb",
          color: "#ffffff",
          borderRadius: "var(--radius-sm)",
          fontSize: 12,
          fontWeight: 700,
          textDecoration: "none",
          whiteSpace: "nowrap",
          flexShrink: 0,
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#1d4ed8")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "#2563eb")}
      >
        ↓ PDFを開く
      </a>

      {/* 閉じるボタン */}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="閉じる"
        style={{
          flexShrink: 0,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#93c5fd",
          fontSize: 18,
          lineHeight: 1,
          padding: "2px 4px",
          borderRadius: 4,
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#2563eb")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#93c5fd")}
      >
        ×
      </button>
    </div>
  );
}

/* ── 統計サマリー ─────────────────────────────────────────────────────── */
function SummaryBar({ items, worksMap }: { items: OaListItem[]; worksMap: Record<string, WorkListItem[]> }) {
  const activeCount  = items.filter((o) => o.publish_status === "active").length;
  const totalWorks   = Object.values(worksMap).reduce((s, ws) => s + ws.length, 0);
  const totalPlayers = Object.values(worksMap).reduce(
    (s, ws) => s + ws.reduce((ss, w) => ss + (w._count.userProgress ?? 0), 0), 0
  );
  return (
    <div style={{
      display: "flex",
      gap: 12,
      marginBottom: 20,
    }}>
      {[
        { label: "アカウント数",   value: items.length,                      icon: "📡", color: "#6366f1" },
        { label: "公開中",         value: activeCount,                       icon: "🟢", color: "var(--color-success)" },
        { label: "総作品数",       value: totalWorks,                        icon: "🎭", color: "#0ea5e9" },
        { label: "総プレイヤー数", value: totalPlayers.toLocaleString(),      icon: "👥", color: "#f59e0b" },
      ].map((s) => (
        <div key={s.label} style={{
          flex: 1,
          padding: "14px 18px",
          background: "var(--surface)",
          border: "1px solid var(--border-light)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-xs)",
        }}>
          <div style={{ fontSize: 20, marginBottom: 6 }}>{s.icon}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ── スケルトン行 ─────────────────────────────────────────────────────── */
function SkeletonRows() {
  return (
    <>
      {[220, 180, 200].map((w, i) => (
        <tr key={i}>
          <td>
            <div className="skeleton" style={{ width: w, height: 14, marginBottom: 6 }} />
            <div className="skeleton" style={{ width: 100, height: 11 }} />
          </td>
          <td><div className="skeleton" style={{ width: 52, height: 22, borderRadius: 11 }} /></td>
          <td><div className="skeleton" style={{ width: 110, height: 14 }} /></td>
          <td style={{ textAlign: "center" }}><div className="skeleton" style={{ width: 32, height: 18, margin: "0 auto" }} /></td>
          <td><div className="skeleton" style={{ width: 72, height: 11 }} /></td>
          <td>
            <div style={{ display: "flex", gap: 4 }}>
              <div className="skeleton" style={{ width: 58, height: 28, borderRadius: 6 }} />
              <div className="skeleton" style={{ width: 44, height: 28, borderRadius: 6 }} />
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

/* ── メインページ ─────────────────────────────────────────────────────── */
export default function OaListPage() {
  const [items, setItems]         = useState<OaListItem[]>([]);
  const [meta, setMeta]           = useState<OaListMeta | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [page, setPage]           = useState(1);
  const [worksMap, setWorksMap]   = useState<Record<string, WorkListItem[]>>({});
  const { showToast }             = useToast();

  async function load(p: number) {
    setLoading(true);
    setError(null);
    try {
      const result = await oaApi.list(getDevToken(), { page: p, limit: 20 });
      setItems(result.data);
      setMeta(result.meta);
      const token = getDevToken();
      const pairs = await Promise.all(
        result.data.map((oa) =>
          workApi.list(token, oa.id)
            .then((ws) => [oa.id, ws] as [string, WorkListItem[]])
            .catch(() => [oa.id, [] as WorkListItem[]] as [string, WorkListItem[]])
        )
      );
      const map: Record<string, WorkListItem[]> = {};
      for (const [id, ws] of pairs) map[id] = ws;
      setWorksMap(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(page); }, [page]);

  async function handleDelete(id: string, title: string) {
    if (!confirm(`「${title}」を削除しますか？\n紐づくすべての作品・キャラクター・フェーズ・メッセージも削除されます。この操作は取り消せません。`)) return;
    try {
      await oaApi.delete(getDevToken(), id);
      showToast(`「${title}」を削除しました`, "success");
      await load(page);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "削除に失敗しました", "error");
    }
  }

  function WorksCell({ oaId }: { oaId: string }) {
    const ws = worksMap[oaId];
    if (!ws) return <span style={{ color: "#9ca3af", fontSize: 12 }}>—</span>;
    if (ws.length === 0) return (
      <Link
        href={`/oas/${oaId}/works`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          fontSize: 11, color: "var(--color-info)",
          padding: "3px 8px",
          background: "#eff6ff",
          border: "1px dashed #bfdbfe",
          borderRadius: "var(--radius-full)",
          textDecoration: "none",
        }}
      >
        ＋ 作品を追加
      </Link>
    );
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {ws.map((w) => (
          <Link
            key={w.id}
            href={`/oas/${oaId}/works/${w.id}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 12, color: "var(--text-primary)",
              textDecoration: "none",
              padding: "2px 0",
              lineHeight: 1.4,
            }}
          >
            <span style={{ color: "var(--text-muted)", fontSize: 11 }}>🎭</span>
            {w.title}
          </Link>
        ))}
      </div>
    );
  }

  function totalPlayers(oaId: string): number {
    return (worksMap[oaId] ?? []).reduce((sum, w) => sum + (w._count.userProgress ?? 0), 0);
  }

  return (
    <>
      {/* ── お知らせ ── */}
      <AnnouncementBanner />

      {/* ── ガイドPDF導線 ── */}
      <GuideBanner />

      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <h2>アカウントリスト</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            1つのLINE公式アカウントにつき複数の謎解き作品を管理できます
          </p>
        </div>
        <Link href="/oas/new" className="btn btn-primary">
          ＋ アカウントを追加
        </Link>
      </div>

      {/* ── エラー ── */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {error}
          <button
            onClick={() => load(page)}
            style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: "inherit" }}
          >
            再読み込み
          </button>
        </div>
      )}

      {/* ── 統計サマリー（データあり かつ ロード完了時） ── */}
      {!loading && items.length > 0 && (
        <SummaryBar items={items} worksMap={worksMap} />
      )}

      {/* ── テーブル / スケルトン / 空 ── */}
      {items.length === 0 && !loading ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📡</div>
            <p className="empty-state-title">アカウントが未登録です</p>
            <p className="empty-state-desc">
              まずLINE公式アカウントを登録してください。<br />
              登録後、アカウントに紐づく謎解き作品を追加できます。
            </p>
            <Link href="/oas/new" className="btn btn-primary" style={{ marginTop: 8 }}>
              ＋ 最初のアカウントを追加する
            </Link>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table style={{ tableLayout: "fixed", width: "100%" }}>
              <colgroup>
                <col style={{ width: "29%" }} />
                <col style={{ width: "76px" }} />
                <col style={{ width: "21%" }} />
                <col style={{ width: "72px" }} />
                <col style={{ width: "96px" }} />
                <col style={{ width: "160px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>アカウント名</th>
                  <th>状態</th>
                  <th>作品</th>
                  <th style={{ textAlign: "center" }}>P数</th>
                  <th>登録 / 更新</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows />
                ) : (
                  items.map((oa) => (
                    <tr key={oa.id}>
                      {/* アカウント名 */}
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <Link
                            href={`/oas/${oa.id}/works`}
                            style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)", textDecoration: "none" }}
                          >
                            {oa.title}
                          </Link>
                          {(oa.my_role === "owner" || oa.my_role === "editor" || oa.my_role === "viewer") && (
                            <RoleBadge role={oa.my_role as Role} />
                          )}
                        </div>
                        {oa.description && (
                          <div style={{
                            fontSize: 11, color: "var(--text-muted)", marginTop: 2,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {oa.description}
                          </div>
                        )}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 6px", marginTop: 5 }}>
                          {oa.channel_id && (
                            <span style={{
                              fontSize: 10, color: "var(--text-muted)",
                              background: "var(--gray-50)",
                              border: "1px solid var(--border-light)",
                              borderRadius: 4,
                              padding: "1px 6px",
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%",
                              fontFamily: "monospace",
                            }}>
                              Ch: {oa.channel_id}
                            </span>
                          )}
                          {oa.line_oa_id && (
                            <span style={{
                              fontSize: 10, color: "var(--text-muted)",
                              background: "var(--gray-50)",
                              border: "1px solid var(--border-light)",
                              borderRadius: 4,
                              padding: "1px 6px",
                              whiteSpace: "nowrap",
                            }}>
                              @{oa.line_oa_id}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 状態バッジ */}
                      <td>
                        <span className={`badge badge-${oa.publish_status}`}>
                          {STATUS_LABEL[oa.publish_status] ?? oa.publish_status}
                        </span>
                      </td>

                      {/* 作品 */}
                      <td>
                        <WorksCell oaId={oa.id} />
                      </td>

                      {/* プレイヤー数 */}
                      <td style={{ textAlign: "center" }}>
                        <span style={{
                          fontWeight: 800, fontSize: 15,
                          color: totalPlayers(oa.id) > 0 ? "var(--color-info)" : "var(--text-disabled)",
                        }}>
                          {totalPlayers(oa.id).toLocaleString()}
                        </span>
                      </td>

                      {/* 日付 */}
                      <td>
                        <div style={{ fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                          {formatDate(oa.created_at)}
                        </div>
                        {oa.updated_at && (
                          <div style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap", marginTop: 2 }}>
                            ↻ {formatDate(oa.updated_at)}
                          </div>
                        )}
                      </td>

                      {/* アクション */}
                      <td>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          <Link
                            href={`/oas/${oa.id}/works`}
                            className="btn btn-primary"
                            style={{ padding: "4px 10px", fontSize: 11 }}
                          >
                            作品管理
                          </Link>
                          <Link
                            href={`/oas/${oa.id}/settings`}
                            className="btn btn-ghost"
                            style={{ padding: "4px 10px", fontSize: 11 }}
                          >
                            設定
                          </Link>
                          {oa.my_role === "owner" && (
                            <button
                              className="btn btn-danger"
                              style={{ padding: "4px 10px", fontSize: 11 }}
                              onClick={() => handleDelete(oa.id, oa.title)}
                            >
                              削除
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* ページネーション */}
          {meta && meta.pages > 1 && (
            <div style={{
              display: "flex", gap: 8, alignItems: "center",
              padding: "12px 20px",
              justifyContent: "flex-end",
              borderTop: "1px solid var(--border-light)",
            }}>
              <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} style={{ padding: "6px 14px", fontSize: 12 }}>
                ← 前へ
              </button>
              <span style={{ fontSize: 12, color: "var(--text-muted)", padding: "0 4px" }}>
                {page} / {meta.pages} ページ（計 {meta.total} 件）
              </span>
              <button className="btn btn-ghost" disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)} style={{ padding: "6px 14px", fontSize: 12 }}>
                次へ →
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
