"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { oaApi, workApi, getDevToken, type OaListItem, type OaListMeta, type WorkListItem } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { usePlatformRole } from "@/hooks/usePlatformRole";
import { RoleBadge } from "@/components/PermissionGuard";
import type { Role } from "@/lib/types/permissions";

// ── 定数 ─────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  draft:  "未設定",
  active: "公開中",
  paused: "停止中",
};

const STATUS_BADGE_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  draft:  { bg: "#f9fafb", color: "#9ca3af", border: "#e5e7eb" },
  active: { bg: "#dcfce7", color: "#166534", border: "#86efac" },
  paused: { bg: "#fef9c3", color: "#854d0e", border: "#fde047" },
};

const ROLE_LABEL: Record<string, string> = {
  owner:  "オーナー",
  admin:  "管理者",
  editor: "編集者",
  viewer: "閲覧者",
};

// ── 日付フォーマット ─────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}/${mo}/${dd}`;
}

// ── スタイル定数 ─────────────────────────────────────────────────────────

const LABEL_STYLE: React.CSSProperties = {
  fontSize:      10,
  fontWeight:    600,
  color:         "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom:  4,
  whiteSpace:    "nowrap",
};

const VALUE_STYLE: React.CSSProperties = {
  fontSize:   13,
  fontWeight: 600,
  color:      "var(--text-primary)",
  lineHeight: 1.4,
};

/* ── 統計サマリー ────────────────────────────────────────────────────────── */
function SummaryBar({ items, worksMap }: { items: OaListItem[]; worksMap: Record<string, WorkListItem[]> }) {
  const activeCount  = items.filter((o) => o.publish_status === "active").length;
  const totalWorks   = Object.values(worksMap).reduce((s, ws) => s + ws.length, 0);
  const totalPlayers = Object.values(worksMap).reduce(
    (s, ws) => s + ws.reduce((ss, w) => ss + (w._count.userProgress ?? 0), 0), 0
  );
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
      {[
        { label: "アカウント数",   value: items.length,                  color: "#6366f1" },
        { label: "公開中",         value: activeCount,                   color: "var(--color-success)" },
        { label: "総作品数",       value: totalWorks,                    color: "#0ea5e9" },
        { label: "総プレイヤー数", value: totalPlayers.toLocaleString(), color: "#f59e0b" },
      ].map((s) => (
        <div key={s.label} style={{
          flex:         1,
          padding:      "14px 18px",
          background:   "var(--surface)",
          border:       "1px solid var(--border-light)",
          borderRadius: "var(--radius-md)",
          boxShadow:    "var(--shadow-xs)",
        }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ── サポートエリア ───────────────────────────────────────────────────────── */
function SupportArea({ isOwner }: { isOwner: boolean }) {
  return (
    <div style={{ marginTop: 40, paddingTop: 24, borderTop: "1px solid var(--color-border-soft)" }}>
      <p style={{
        fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)",
        textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12,
      }}>
        サポート
      </p>
      <div style={{
        display: "flex", alignItems: "center", gap: 18,
        padding: "18px 22px",
        background: "var(--color-bg-default)",
        border: "1px solid var(--color-border-soft)",
        borderRadius: 12,
      }}>
        <span style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 40, height: 40, borderRadius: 10,
          background: "var(--gray-100)", fontSize: 20, flexShrink: 0,
        }}>
          📄
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 3 }}>
            はじめての方へ — 使い方ガイド
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
            セットアップ・LINEチャンネル連携・シナリオ公開までの手順をまとめたPDFです。まずこちらをご確認ください。
          </div>
        </div>
        <div style={{ flexShrink: 0, textAlign: "center" }}>
          {isOwner ? (
            <button
              type="button"
              title="PDF ガイドのアップロード（近日公開）"
              onClick={() => alert("PDF アップロード機能は近日公開予定です。")}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 18px", fontSize: 12, fontWeight: 600,
                color: "#fff", background: "var(--color-primary, #2F6F5E)",
                border: "none", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              <span style={{ fontSize: 14 }}>📤</span>PDFをアップロード
            </button>
          ) : (
            <>
              <button
                disabled
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 18px", fontSize: 12, fontWeight: 600,
                  color: "var(--color-text-muted)", background: "var(--gray-100)",
                  border: "1px solid var(--color-border-soft)", borderRadius: 8,
                  cursor: "not-allowed", opacity: 0.5, whiteSpace: "nowrap",
                }}
              >
                <span style={{ fontSize: 14 }}>📥</span>PDFを開く
              </button>
              <p style={{ fontSize: 11, color: "#dc2626", marginTop: 5 }}>
                ※実装前のため、ご利用いただけません
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 行アクションボタン ─────────────────────────────────────────────────── */
function RowActions({ oaId, isOwner, onDelete }: {
  oaId:     string;
  isOwner:  boolean;
  onDelete: () => void;
}) {
  return (
    <div style={{
      display:        "flex",
      flexDirection:  "column",
      gap:            10,
      alignItems:     "stretch",
      minWidth:       108,
    }}>
      <Link
        href={`/oas/${oaId}/works`}
        className="btn btn-primary"
        style={{
          padding:    "9px 18px",
          fontSize:   13,
          fontWeight: 700,
          textAlign:  "center",
          display:    "block",
          whiteSpace: "nowrap",
        }}
      >
        作品管理
      </Link>
      <Link
        href={`/oas/${oaId}/settings`}
        className="btn btn-ghost"
        style={{
          padding:    "9px 18px",
          fontSize:   13,
          textAlign:  "center",
          display:    "block",
          whiteSpace: "nowrap",
        }}
      >
        設定
      </Link>
      {isOwner && (
        <button
          type="button"
          className="btn btn-danger"
          style={{ padding: "9px 18px", fontSize: 13, whiteSpace: "nowrap" }}
          onClick={onDelete}
        >
          削除
        </button>
      )}
    </div>
  );
}

/* ── 作品名セル ──────────────────────────────────────────────────────────── */
function WorksCell({
  oaId,
  worksMap,
  worksLoading,
}: {
  oaId: string;
  worksMap: Record<string, WorkListItem[]>;
  worksLoading: boolean;
}) {
  // 作品リスト取得中はスケルトン表示
  if (worksLoading) {
    return <div className="skeleton" style={{ width: 100, height: 14, borderRadius: 4 }} />;
  }
  const ws = worksMap[oaId];
  // API エラー等で取得できなかった場合（undefined）は "+ 作品を追加" を表示
  if (!ws || ws.length === 0) return (
    <Link
      href={`/oas/${oaId}/works`}
      style={{
        display:        "inline-flex",
        alignItems:     "center",
        gap:            4,
        fontSize:       12,
        color:          "var(--color-info)",
        padding:        "3px 9px",
        background:     "#eff6ff",
        border:         "1px dashed #bfdbfe",
        borderRadius:   "var(--radius-full)",
        textDecoration: "none",
        whiteSpace:     "nowrap",
      }}
    >
      ＋ 作品を追加
    </Link>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {ws.map((w) => (
        <Link
          key={w.id}
          href={`/oas/${oaId}/works/${w.id}`}
          title={`${w.title} の作品管理へ`}
          style={{
            display:        "inline-flex",
            alignItems:     "center",
            gap:            3,
            fontSize:       13,
            fontWeight:     600,
            color:          "var(--text-primary)",
            textDecoration: "none",
            lineHeight:     1.4,
            maxWidth:       "100%",
            transition:     "color .15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color           = "var(--color-primary, #2F6F5E)";
            e.currentTarget.style.textDecoration  = "underline";
            e.currentTarget.style.textUnderlineOffset = "2px";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color          = "var(--text-primary)";
            e.currentTarget.style.textDecoration = "none";
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {w.title}
          </span>
          <span style={{ fontSize: 13, color: "#9ca3af", flexShrink: 0, lineHeight: 1 }}>›</span>
        </Link>
      ))}
    </div>
  );
}

/* ── スケルトン行 ─────────────────────────────────────────────────────────── */
function SkeletonList() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            display:      "flex",
            gap:          24,
            alignItems:   "flex-start",
            padding:      "22px 24px",
            borderBottom: "1px solid var(--border-light)",
          }}
        >
          {/* 左: 情報エリア */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="skeleton" style={{ width: 180 + i * 30, height: 18, borderRadius: 4, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: 100, height: 11, borderRadius: 4, marginBottom: 20 }} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 28px" }}>
              {[60, 72, 140, 66, 66].map((w, j) => (
                <div key={j}>
                  <div className="skeleton" style={{ width: 40, height: 9, borderRadius: 3, marginBottom: 6 }} />
                  <div className="skeleton" style={{ width: w, height: 13, borderRadius: 4 }} />
                </div>
              ))}
            </div>
          </div>
          {/* 右: ボタンエリア */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 108 }}>
            <div className="skeleton" style={{ height: 38, borderRadius: 8 }} />
            <div className="skeleton" style={{ height: 38, borderRadius: 8 }} />
          </div>
        </div>
      ))}
    </>
  );
}

/* ── メインページ ──────────────────────────────────────────────────────────── */
export default function OaListPage() {
  const [items,        setItems]        = useState<OaListItem[]>([]);
  const [meta,         setMeta]         = useState<OaListMeta | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [worksLoading, setWorksLoading] = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [page,         setPage]         = useState(1);
  const [worksMap,     setWorksMap]     = useState<Record<string, WorkListItem[]>>({});
  const { showToast }           = useToast();
  const { effectiveRole, isPlatformOwner, setPreviewRole } = usePlatformRole();

  const actAsOwner = isPlatformOwner && effectiveRole === "owner";

  async function load(p: number) {
    setLoading(true);
    setWorksLoading(true);
    setError(null);
    try {
      const result = await oaApi.list(getDevToken(), { page: p, limit: 20 });
      setItems(result.data);
      setMeta(result.meta);
      // OA一覧が揃った時点で loading を解除 → OAカードを先行表示
      setLoading(false);

      // 作品リストは OA 一覧とは独立してフェッチ（既存作品の表示は subscription 制限とは無関係）
      // エラー時は [] として扱うが、OAカード自体の表示はブロックしない
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
      setLoading(false);
    } finally {
      setWorksLoading(false);
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

  function totalPlayers(oaId: string): number {
    return (worksMap[oaId] ?? []).reduce((sum, w) => sum + (w._count.userProgress ?? 0), 0);
  }

  return (
    <>
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

      {/* ── β版 遅延注意バナー ── */}
      <div style={{
        display: "flex", alignItems: "flex-start", gap: 10,
        background: "#fffbeb", border: "1px solid #fcd34d",
        borderRadius: "var(--radius-md)", padding: "12px 16px",
        marginBottom: 16, fontSize: 13, color: "#92400e", lineHeight: 1.6,
      }}>
        <span>
          現在「Whale Studio β版」では、メッセージの処理に遅延が発生する場合があります。
          現在改善を進めておりますので、あらかじめご了承ください。
        </span>
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

      {/* ── 統計サマリー ── */}
      {!loading && !worksLoading && items.length > 0 && (
        <SummaryBar items={items} worksMap={worksMap} />
      )}

      {/* ── 一覧 / スケルトン / 空 ── */}
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
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {loading ? (
            <SkeletonList />
          ) : (
            items.map((oa, idx) => {
              const isLast        = idx === items.length - 1;
              const statusStyle   = STATUS_BADGE_STYLE[oa.publish_status] ?? STATUS_BADGE_STYLE.draft;
              const players       = totalPlayers(oa.id);
              const roleText      = ROLE_LABEL[oa.my_role] ?? null;
              const hasRole       = oa.my_role && oa.my_role !== 'none';

              return (
                <div
                  key={oa.id}
                  style={{
                    display:      "flex",
                    gap:          24,
                    alignItems:   "flex-start",
                    padding:      "22px 24px",
                    borderBottom: isLast ? "none" : "1px solid var(--border-light)",
                    transition:   "background .1s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-50, #fafafa)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
                >
                  {/* ─── 左: 情報エリア ─── */}
                  <div style={{ flex: 1, minWidth: 0 }}>

                    {/* アカウント名 + 状態バッジ */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{
                        fontSize:     16,
                        fontWeight:   800,
                        color:        "var(--text-primary)",
                        overflow:     "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace:   "nowrap",
                        lineHeight:   1.3,
                      }}>
                        {oa.title}
                      </span>
                      <span style={{
                        display:      "inline-block",
                        padding:      "2px 8px",
                        borderRadius: 20,
                        fontSize:     10,
                        fontWeight:   700,
                        background:   statusStyle.bg,
                        color:        statusStyle.color,
                        border:       `1px solid ${statusStyle.border}`,
                        whiteSpace:   "nowrap",
                        flexShrink:   0,
                      }}>
                        {STATUS_LABEL[oa.publish_status] ?? oa.publish_status}
                      </span>
                    </div>

                    {/* Ch ID / OA ID チップ */}
                    {(oa.channel_id || oa.line_oa_id) && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
                        {oa.channel_id && (
                          <span
                            title={`Channel ID: ${oa.channel_id}`}
                            style={{
                              fontSize: 10, color: "var(--text-muted)",
                              background: "var(--gray-50)", border: "1px solid var(--border-light)",
                              borderRadius: 4, padding: "1px 6px",
                              fontFamily: "monospace", whiteSpace: "nowrap",
                            }}
                          >
                            {oa.channel_id.length > 10
                              ? `${oa.channel_id.slice(0, 4)}…${oa.channel_id.slice(-4)}`
                              : oa.channel_id}
                          </span>
                        )}
                        {oa.line_oa_id && (
                          <span
                            title={`アカウントID: @${oa.line_oa_id}`}
                            style={{
                              fontSize: 10, color: "var(--text-muted)",
                              background: "var(--gray-50)", border: "1px solid var(--border-light)",
                              borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap",
                            }}
                          >
                            @{oa.line_oa_id}
                          </span>
                        )}
                      </div>
                    )}

                    {/* ─ 情報グリッド（ラベル + 値 の 2段） ─ */}
                    <div style={{
                      display:   "flex",
                      flexWrap:  "wrap",
                      gap:       "12px 32px",
                      marginTop: (oa.channel_id || oa.line_oa_id) ? 0 : 14,
                    }}>

                      {/* 権限 */}
                      {hasRole && (
                        <div>
                          <div style={LABEL_STYLE}>権限</div>
                          <div style={{ ...VALUE_STYLE, display: 'flex', alignItems: 'center' }}>
                            <RoleBadge role={oa.my_role as Role} />
                          </div>
                        </div>
                      )}

                      {/* プレイヤー数 */}
                      <div>
                        <div style={LABEL_STYLE}>プレイヤー数</div>
                        <div style={{
                          ...VALUE_STYLE,
                          fontSize: 14,
                          fontWeight: 800,
                          color: players > 0 ? "var(--color-info, #0ea5e9)" : "var(--text-muted)",
                        }}>
                          {players.toLocaleString()}
                        </div>
                      </div>

                      {/* 作品名 */}
                      <div style={{ minWidth: 120, maxWidth: 280 }}>
                        <div style={LABEL_STYLE}>作品名</div>
                        <WorksCell oaId={oa.id} worksMap={worksMap} worksLoading={worksLoading} />
                      </div>

                      {/* 作成日時 */}
                      <div>
                        <div style={LABEL_STYLE}>作成日時</div>
                        <div style={{ ...VALUE_STYLE, color: "var(--text-secondary)" }}>
                          {formatDate(oa.created_at)}
                        </div>
                      </div>

                      {/* 更新日時 */}
                      <div>
                        <div style={LABEL_STYLE}>更新日時</div>
                        <div style={{ ...VALUE_STYLE, color: "var(--text-secondary)" }}>
                          {formatDate(oa.updated_at ?? oa.created_at)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ─── 右: ボタンエリア ─── */}
                  <div style={{ flexShrink: 0 }}>
                    <RowActions
                      oaId={oa.id}
                      isOwner={oa.my_role === "owner" && actAsOwner}
                      onDelete={() => handleDelete(oa.id, oa.title)}
                    />
                  </div>
                </div>
              );
            })
          )}

          {/* ── ページネーション ── */}
          {meta && meta.pages > 1 && (
            <div style={{
              display:        "flex",
              gap:            8,
              alignItems:     "center",
              padding:        "12px 20px",
              justifyContent: "flex-end",
              borderTop:      "1px solid var(--border-light)",
            }}>
              <button
                className="btn btn-ghost"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                style={{ padding: "6px 14px", fontSize: 12 }}
              >
                ← 前へ
              </button>
              <span style={{ fontSize: 12, color: "var(--text-muted)", padding: "0 4px" }}>
                {page} / {meta.pages} ページ（計 {meta.total} 件）
              </span>
              <button
                className="btn btn-ghost"
                disabled={page >= meta.pages}
                onClick={() => setPage((p) => p + 1)}
                style={{ padding: "6px 14px", fontSize: 12 }}
              >
                次へ →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 一般ユーザープレビュー中バナー ── */}
      {isPlatformOwner && !actAsOwner && (
        <div style={{
          display:      "flex",
          alignItems:   "center",
          gap:          10,
          background:   "#fffbeb",
          border:       "1px solid #fde68a",
          borderRadius: "var(--radius-md)",
          padding:      "10px 16px",
          marginBottom: 16,
          fontSize:     13,
          color:        "#92400e",
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>👁</span>
          <span style={{ flex: 1 }}>
            <strong>一般ユーザープレビュー中</strong> — 一般ユーザーからの見え方を表示しています。
          </span>
          <button
            type="button"
            onClick={() => setPreviewRole(null)}
            style={{
              fontSize: 12, fontWeight: 600, color: "#92400e",
              background: "#fef3c7", border: "1px solid #fde68a",
              borderRadius: 6, padding: "3px 10px", cursor: "pointer",
              whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            オーナー表示に戻す
          </button>
        </div>
      )}

      {/* ── お知らせ ── */}
      <div style={{ marginTop: 32 }}>
        <AnnouncementBanner canPost={actAsOwner} />
      </div>

      {/* ── サポートエリア ── */}
      <SupportArea isOwner={actAsOwner} />
    </>
  );
}
