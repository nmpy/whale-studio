"use client";

import { useEffect, useRef, useState } from "react";
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

/* ── サポートエリア ───────────────────────────────────────────────────── */
function SupportArea() {
  const cardBase: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    padding: "16px 18px",
    background: "var(--color-bg-default)",
    border: "1px solid var(--color-border-soft)",
    borderRadius: 12,
    textDecoration: "none",
    color: "inherit",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    transition: "border-color .15s, background .15s",
  };

  function CardIcon({ bg, children }: { bg: string; children: React.ReactNode }) {
    return (
      <span style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 34, height: 34, borderRadius: 8,
        background: bg, fontSize: 16, flexShrink: 0,
      }}>
        {children}
      </span>
    );
  }

  function CardBody({ title, desc }: { title: string; desc: string }) {
    return (
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 2 }}>
          {title}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
          {desc}
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 52, paddingTop: 28, borderTop: "1px solid var(--color-border-soft)" }}>
      <p style={{
        fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)",
        textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14,
      }}>
        サポート
      </p>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 10,
      }}>
        {/* 使い方ガイド */}
        <a
          href="/guide.pdf"
          target="_blank"
          rel="noopener noreferrer"
          style={cardBase}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--color-primary)";
            e.currentTarget.style.background  = "var(--color-primary-soft)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--color-border-soft)";
            e.currentTarget.style.background  = "var(--color-bg-default)";
          }}
        >
          <CardIcon bg="var(--color-primary-soft)">📄</CardIcon>
          <CardBody
            title="使い方ガイド"
            desc="セットアップ〜シナリオ公開までの手順をまとめたPDFです"
          />
        </a>

        {/* 共通メッセージのヒント */}
        <div
          style={{ ...cardBase, cursor: "default" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = "#d1d5db";
            (e.currentTarget as HTMLDivElement).style.background  = "var(--color-bg-subtle)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border-soft)";
            (e.currentTarget as HTMLDivElement).style.background  = "var(--color-bg-default)";
          }}
        >
          <CardIcon bg="#f0fdf4">💬</CardIcon>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 2 }}>
              共通メッセージ
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
              ヒント・ヘルプなどフェーズに関係なく反応するメッセージは、
              メッセージ作成画面の「メッセージ役割」から設定できます
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 行アクション（⋯ ケバブメニュー付き）──────────────────────────────── */
function RowActions({
  oaId,
  isOwner,
  onDelete,
}: {
  oaId:     string;
  isOwner:  boolean;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onOutside(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [menuOpen]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
      {/* 主操作 */}
      <Link
        href={`/oas/${oaId}/works`}
        className="btn btn-primary"
        style={{ padding: "4px 10px", fontSize: 11, whiteSpace: "nowrap" }}
      >
        作品管理
      </Link>
      <Link
        href={`/oas/${oaId}/settings`}
        className="btn btn-ghost"
        style={{ padding: "4px 10px", fontSize: 11, whiteSpace: "nowrap" }}
      >
        設定
      </Link>

      {/* 危険操作：ケバブメニュー（owner のみ） */}
      {isOwner && (
        <div style={{ position: "relative" }} ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            title="その他の操作"
            aria-label="その他の操作"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26,
              background: menuOpen ? "#f3f4f6" : "transparent",
              border: `1px solid ${menuOpen ? "#e5e7eb" : "transparent"}`,
              borderRadius: 6,
              cursor: "pointer",
              color: "#9ca3af",
              fontSize: 14,
              letterSpacing: "0.05em",
              lineHeight: 1,
              transition: "background .15s, border-color .15s, color .15s",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background   = "#f3f4f6";
              e.currentTarget.style.borderColor  = "#e5e7eb";
              e.currentTarget.style.color        = "#374151";
            }}
            onMouseLeave={(e) => {
              if (!menuOpen) {
                e.currentTarget.style.background  = "transparent";
                e.currentTarget.style.borderColor = "transparent";
                e.currentTarget.style.color       = "#9ca3af";
              }
            }}
          >
            ⋯
          </button>

          {menuOpen && (
            <div
              role="menu"
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 4px)",
                zIndex: 50,
                minWidth: 112,
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                boxShadow: "0 4px 12px rgba(0,0,0,.10), 0 1px 4px rgba(0,0,0,.06)",
                padding: "4px 0",
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onDelete(); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 14px",
                  fontSize: 12,
                  fontWeight: 500,
                  color: "#dc2626",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  transition: "background .1s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#fef2f2")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              >
                <span style={{ fontSize: 13 }}>🗑</span>
                削除
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── スケルトン行 ─────────────────────────────────────────────────────── */
function SkeletonRows() {
  return (
    <>
      {[160, 140, 180].map((w, i) => (
        <tr key={i}>
          <td>
            <div className="skeleton" style={{ width: w, height: 13, marginBottom: 5 }} />
            <div className="skeleton" style={{ width: 88, height: 10 }} />
          </td>
          <td><div className="skeleton" style={{ width: 48, height: 20, borderRadius: 10 }} /></td>
          <td><div className="skeleton" style={{ width: 96, height: 13 }} /></td>
          <td style={{ textAlign: "center" }}><div className="skeleton" style={{ width: 28, height: 16, margin: "0 auto" }} /></td>
          <td><div className="skeleton" style={{ width: 66, height: 11 }} /></td>
          <td>
            <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
              <div className="skeleton" style={{ width: 54, height: 26, borderRadius: 6 }} />
              <div className="skeleton" style={{ width: 38, height: 26, borderRadius: 6 }} />
              <div className="skeleton" style={{ width: 26, height: 26, borderRadius: 6 }} />
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
          padding: "2px 7px",
          background: "#eff6ff",
          border: "1px dashed #bfdbfe",
          borderRadius: "var(--radius-full)",
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        ＋ 作品を追加
      </Link>
    );
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {ws.map((w) => (
          <Link
            key={w.id}
            href={`/oas/${oaId}/works/${w.id}`}
            title={w.title}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              fontSize: 12, color: "var(--text-primary)",
              textDecoration: "none",
              lineHeight: 1.4,
              minWidth: 0,
            }}
          >
            <span style={{ color: "var(--text-muted)", fontSize: 10, flexShrink: 0 }}>🎭</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {w.title}
            </span>
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
            <table className="table-compact" style={{ tableLayout: "fixed", width: "100%" }}>
              <colgroup>
                {/* アカウント名: 可変・広め */}
                <col style={{ width: "27%" }} />
                {/* 状態 */}
                <col style={{ width: "60px" }} />
                {/* 作品: 可変 */}
                <col style={{ width: "21%" }} />
                {/* P数 */}
                <col style={{ width: "50px" }} />
                {/* 登録/更新 */}
                <col style={{ width: "80px" }} />
                {/* アクション */}
                <col style={{ width: "128px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>アカウント名</th>
                  <th>状態</th>
                  <th>作品</th>
                  <th style={{ textAlign: "center" }}>P数</th>
                  <th>更新日</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows />
                ) : (
                  items.map((oa) => (
                    <tr key={oa.id}>
                      {/* ── アカウント名 ── */}
                      <td style={{ minWidth: 0 }}>
                        {/* 名前 + ロールバッジ */}
                        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                          <Link
                            href={`/oas/${oa.id}/works`}
                            title={oa.title}
                            style={{
                              fontWeight: 700, fontSize: 13,
                              color: "var(--text-primary)",
                              textDecoration: "none",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              minWidth: 0,
                            }}
                          >
                            {oa.title}
                          </Link>
                          {(oa.my_role === "owner" || oa.my_role === "editor" || oa.my_role === "viewer") && (
                            <span style={{ flexShrink: 0 }}>
                              <RoleBadge role={oa.my_role as Role} />
                            </span>
                          )}
                        </div>
                        {/* 説明 */}
                        {oa.description && (
                          <div
                            title={oa.description}
                            style={{
                              fontSize: 11, color: "var(--text-muted)", marginTop: 2,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}
                          >
                            {oa.description}
                          </div>
                        )}
                        {/* Ch ID / OA ID チップ */}
                        <div style={{ display: "flex", flexWrap: "nowrap", gap: 4, marginTop: 4, minWidth: 0, overflow: "hidden" }}>
                          {oa.channel_id && (
                            <span
                              title={`Channel ID: ${oa.channel_id}`}
                              style={{
                                fontSize: 10, color: "var(--text-muted)",
                                background: "var(--gray-50)",
                                border: "1px solid var(--border-light)",
                                borderRadius: 4,
                                padding: "1px 5px",
                                fontFamily: "monospace",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                maxWidth: 96,
                                flexShrink: 1,
                                display: "inline-block",
                              }}
                            >
                              {oa.channel_id.length > 10
                                ? `${oa.channel_id.slice(0, 4)}…${oa.channel_id.slice(-4)}`
                                : oa.channel_id}
                            </span>
                          )}
                          {oa.line_oa_id && (
                            <span
                              title={`OA ID: @${oa.line_oa_id}`}
                              style={{
                                fontSize: 10, color: "var(--text-muted)",
                                background: "var(--gray-50)",
                                border: "1px solid var(--border-light)",
                                borderRadius: 4,
                                padding: "1px 5px",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                maxWidth: 80,
                                flexShrink: 1,
                                display: "inline-block",
                              }}
                            >
                              @{oa.line_oa_id}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* ── 状態バッジ ── */}
                      <td>
                        <span className={`badge badge-${oa.publish_status}`}>
                          {STATUS_LABEL[oa.publish_status] ?? oa.publish_status}
                        </span>
                      </td>

                      {/* ── 作品 ── */}
                      <td style={{ minWidth: 0 }}>
                        <WorksCell oaId={oa.id} />
                      </td>

                      {/* ── プレイヤー数 ── */}
                      <td style={{ textAlign: "center" }}>
                        <span style={{
                          fontWeight: 800, fontSize: 14,
                          color: totalPlayers(oa.id) > 0 ? "var(--color-info)" : "var(--text-disabled)",
                        }}>
                          {totalPlayers(oa.id).toLocaleString()}
                        </span>
                      </td>

                      {/* ── 更新日 ── */}
                      <td>
                        <div style={{ fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                          {formatDate(oa.updated_at ?? oa.created_at)}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap", marginTop: 1 }}>
                          {formatDate(oa.created_at)} 作成
                        </div>
                      </td>

                      {/* ── アクション（主操作 ＋ ⋯メニュー） ── */}
                      <td style={{ paddingRight: 12 }}>
                        <RowActions
                          oaId={oa.id}
                          isOwner={oa.my_role === "owner"}
                          onDelete={() => handleDelete(oa.id, oa.title)}
                        />
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

      {/* ── お知らせ ── */}
      <AnnouncementBanner />

      {/* ── サポートエリア ── */}
      <SupportArea />
    </>
  );
}
