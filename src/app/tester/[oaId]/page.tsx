"use client";

// src/app/tester/[oaId]/page.tsx
//
// テスターポータル — OA 1件をカードリスト形式で表示。
// /oas/page.tsx のカードリストレイアウトに揃えた版。

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { oaApi, workApi, friendAddApi, getDevToken, type WorkListItem } from "@/lib/api-client";
import type { FriendAddSettings } from "@/types";
import { STATUS_LABEL, STATUS_BADGE_STYLE } from "@/constants/workStatus";
import { FriendAddSection } from "@/components/FriendAddSection";
import { TesterBanner } from "@/components/TesterBanner";

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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/* ── スケルトン（/oas/page.tsx SkeletonList に揃える） ───────────────────── */
function SkeletonItem() {
  return (
    <div style={{
      display:    "flex",
      gap:        24,
      alignItems: "flex-start",
      padding:    "22px 24px",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="skeleton" style={{ width: 200, height: 18, borderRadius: 4, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 100, height: 11, borderRadius: 4, marginBottom: 20 }} />
        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "12px 28px" }}>
          {[60, 72, 140, 66, 66].map((w, i) => (
            <div key={i}>
              <div className="skeleton" style={{ width: 40, height: 9, borderRadius: 3, marginBottom: 6 }} />
              <div className="skeleton" style={{ width: w, height: 13, borderRadius: 4 }} />
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 10, minWidth: 108 }}>
        <div className="skeleton" style={{ height: 38, borderRadius: 8 }} />
      </div>
    </div>
  );
}

/* ── メインページ ────────────────────────────────────────────── */
export default function TesterHomePage() {
  const params = useParams<{ oaId: string }>();
  const oaId   = params.oaId;

  const [oa, setOa]               = useState<Awaited<ReturnType<typeof oaApi.get>> | null>(null);
  const [works, setWorks]         = useState<WorkListItem[]>([]);
  const [friendAdd, setFriendAdd] = useState<FriendAddSettings | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = getDevToken();
      const [oaData, list, fa] = await Promise.all([
        oaApi.get(token, oaId),
        workApi.list(token, oaId),
        friendAddApi.get(token, oaId).catch(() => null),
      ]);
      setOa(oaData);
      setWorks(list);
      setFriendAdd(fa);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [oaId]);

  const totalPlayers  = works.reduce((s, w) => s + (w._count.userProgress ?? 0), 0);
  const activeCount   = works.filter((w) => w.publish_status === "active").length;
  const statusStyle   = oa ? (STATUS_BADGE_STYLE[oa.publish_status] ?? STATUS_BADGE_STYLE.draft) : STATUS_BADGE_STYLE.draft;

  return (
    <>
      {/* ── テスターモードバナー ── */}
      <TesterBanner />

      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <h2>アカウントリスト</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            テスターモード — アカウントや作品を自由に作成・編集できます
          </p>
        </div>
      </div>

      {/* ── エラー ── */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {error}
          <button
            onClick={load}
            style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: "inherit" }}
          >
            再読み込み
          </button>
        </div>
      )}

      {/* ── カードリスト（/oas/page.tsx レイアウトに揃える） ── */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <SkeletonItem />
        ) : oa ? (
          <div
            style={{
              display:    "flex",
              gap:        24,
              alignItems: "flex-start",
              padding:    "22px 24px",
              transition: "background .1s",
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
              {((oa as { channel_id?: string | null }).channel_id || (oa as { line_oa_id?: string | null }).line_oa_id) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
                  {(oa as { channel_id?: string | null }).channel_id && (
                    <span
                      title={`Channel ID: ${(oa as { channel_id: string }).channel_id}`}
                      style={{
                        fontSize: 10, color: "var(--text-muted)",
                        background: "var(--gray-50)", border: "1px solid var(--border-light)",
                        borderRadius: 4, padding: "1px 6px",
                        fontFamily: "monospace", whiteSpace: "nowrap",
                      }}
                    >
                      {((oa as { channel_id: string }).channel_id).length > 10
                        ? `${((oa as { channel_id: string }).channel_id).slice(0, 4)}…${((oa as { channel_id: string }).channel_id).slice(-4)}`
                        : (oa as { channel_id: string }).channel_id}
                    </span>
                  )}
                  {(oa as { line_oa_id?: string | null }).line_oa_id && (
                    <span
                      title={`アカウントID: @${(oa as { line_oa_id: string }).line_oa_id}`}
                      style={{
                        fontSize: 10, color: "var(--text-muted)",
                        background: "var(--gray-50)", border: "1px solid var(--border-light)",
                        borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap",
                      }}
                    >
                      @{(oa as { line_oa_id: string }).line_oa_id}
                    </span>
                  )}
                </div>
              )}

              {/* ─ 情報グリッド（/oas/page.tsx と同じ 2段 ラベル+値） ─ */}
              <div style={{
                display:   "flex",
                flexWrap:  "wrap",
                gap:       "12px 32px",
                marginTop: ((oa as { channel_id?: string | null }).channel_id || (oa as { line_oa_id?: string | null }).line_oa_id) ? 0 : 14,
              }}>

                {/* プレイヤー数 */}
                <div>
                  <div style={LABEL_STYLE}>プレイヤー数</div>
                  <div style={{
                    ...VALUE_STYLE,
                    fontSize:   14,
                    fontWeight: 800,
                    color:      totalPlayers > 0 ? "var(--color-info, #0ea5e9)" : "var(--text-muted)",
                  }}>
                    {totalPlayers.toLocaleString()}
                  </div>
                </div>

                {/* 作品 */}
                <div>
                  <div style={LABEL_STYLE}>作品数</div>
                  <div style={VALUE_STYLE}>
                    {works.length}件
                    {activeCount > 0 && (
                      <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
                        （公開中 {activeCount}）
                      </span>
                    )}
                  </div>
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
              <Link
                href={`/tester/${oaId}/works`}
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
            </div>
          </div>
        ) : null}
      </div>

      {/* ── 友だち追加セクション ── */}
      {!loading && friendAdd?.add_url && (
        <FriendAddSection addUrl={friendAdd.add_url} />
      )}
    </>
  );
}
