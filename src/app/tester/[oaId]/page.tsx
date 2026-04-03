"use client";

// src/app/tester/[oaId]/page.tsx
//
// テスターポータル — アカウントリスト形式で1件のOAを表示。

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { oaApi, workApi, friendAddApi, getDevToken, type WorkListItem } from "@/lib/api-client";
import type { FriendAddSettings } from "@/types";

const STATUS_LABEL: Record<string, string> = {
  draft:  "未設定",
  active: "公開中",
  paused: "停止中",
};

const STATUS_BADGE: Record<string, { color: string; bg: string }> = {
  draft:  { color: "#6b7280", bg: "#f3f4f6" },
  active: { color: "#166534", bg: "#dcfce7" },
  paused: { color: "#92400e", bg: "#fef3c7" },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/* ── スケルトン行 ─────────────────────────────────────────────── */
function SkeletonRow() {
  return (
    <tr>
      <td>
        <div className="skeleton" style={{ width: 160, height: 13, marginBottom: 5 }} />
        <div className="skeleton" style={{ width: 88, height: 10 }} />
      </td>
      <td><div className="skeleton" style={{ width: 48, height: 20, borderRadius: 10 }} /></td>
      <td><div className="skeleton" style={{ width: 60, height: 13 }} /></td>
      <td style={{ textAlign: "center" }}><div className="skeleton" style={{ width: 32, height: 16, margin: "0 auto" }} /></td>
      <td><div className="skeleton" style={{ width: 66, height: 11 }} /></td>
      <td>
        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
          <div className="skeleton" style={{ width: 54, height: 26, borderRadius: 6 }} />
        </div>
      </td>
    </tr>
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

  useEffect(() => {
    const token = getDevToken();
    Promise.all([
      oaApi.get(token, oaId),
      workApi.list(token, oaId),
      friendAddApi.get(token, oaId).catch(() => null),
    ])
      .then(([oaData, list, fa]) => {
        setOa(oaData);
        setWorks(list);
        setFriendAdd(fa);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [oaId]);

  const totalPlayers = works.reduce((s, w) => s + (w._count.userProgress ?? 0), 0);
  const activeCount  = works.filter((w) => w.publish_status === "active").length;

  const badgeStyle = oa ? (STATUS_BADGE[oa.publish_status] ?? STATUS_BADGE.draft) : STATUS_BADGE.draft;

  return (
    <>
      {/* ── テスターモードバナー ── */}
      <div style={{
        padding: "12px 16px",
        background: "#fffbeb",
        border: "1px solid #fde68a",
        borderRadius: "var(--radius-md)",
        marginBottom: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 15 }}>🔍</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>テスターモード</span>
          <span style={{ fontSize: 13, color: "#92400e" }}>—</span>
          <span style={{ fontSize: 13, color: "#92400e" }}>
            このポータルは確認・テスト専用です。編集・削除はできません。
          </span>
        </div>
        <div style={{
          display: "flex", flexDirection: "column", gap: 2,
          paddingLeft: 23,
          fontSize: 12, color: "#b45309",
          lineHeight: 1.6,
        }}>
          <span>※ このシステムはテスター用の β 版です。</span>
          <span>一部機能は開発中のため、挙動が変わる可能性があります。</span>
        </div>
      </div>

      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <h2>アカウントリスト</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            テスター専用ビュー — 閲覧・テスト実行のみ可能です
          </p>
        </div>
      </div>

      {/* ── エラー ── */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>
      )}

      {/* ── アカウントテーブル（1件） ── */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table-compact" style={{ tableLayout: "fixed", width: "100%" }}>
            <colgroup>
              <col style={{ width: "28%" }} />
              <col style={{ width: "60px" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "80px" }} />
              <col style={{ width: "80px" }} />
              <col style={{ width: "120px" }} />
            </colgroup>
            <thead>
              <tr>
                <th>アカウント名</th>
                <th>状態</th>
                <th>作品</th>
                <th style={{ textAlign: "center" }}>プレイヤー数</th>
                <th>更新日</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRow />
              ) : oa ? (
                <tr>
                  {/* ── アカウント名 ── */}
                  <td style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                      <Link
                        href={`/tester/${oaId}/works`}
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
                    </div>
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
                  </td>

                  {/* ── 状態バッジ ── */}
                  <td>
                    <span style={{
                      display: "inline-flex", alignItems: "center",
                      fontSize: 11, fontWeight: 700,
                      color: badgeStyle.color, background: badgeStyle.bg,
                      padding: "2px 8px", borderRadius: "var(--radius-full)",
                      whiteSpace: "nowrap",
                    }}>
                      {STATUS_LABEL[oa.publish_status] ?? oa.publish_status}
                    </span>
                  </td>

                  {/* ── 作品 ── */}
                  <td>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                      {works.length}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 3 }}>
                      件（公開中 {activeCount}）
                    </span>
                  </td>

                  {/* ── プレイヤー数 ── */}
                  <td style={{ textAlign: "center" }}>
                    <span style={{
                      fontWeight: 800, fontSize: 14,
                      color: totalPlayers > 0 ? "var(--color-info)" : "var(--text-disabled)",
                    }}>
                      {totalPlayers.toLocaleString()}
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

                  {/* ── アクション ── */}
                  <td style={{ paddingRight: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                      <Link
                        href={`/tester/${oaId}/works`}
                        className="btn btn-primary"
                        style={{ padding: "4px 10px", fontSize: 11, whiteSpace: "nowrap" }}
                      >
                        作品管理
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 友だち追加セクション ── */}
      {!loading && friendAdd?.add_url && (
        <div style={{
          padding: "16px 20px",
          background: "var(--surface)",
          border: "1px solid var(--border-light)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-xs)",
          marginTop: 20,
          display: "flex",
          alignItems: "flex-start",
          gap: 20,
          flexWrap: "wrap",
        }}>
          {/* テキスト + ボタン */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5 }}>
              🔗 友だち追加
            </p>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.6 }}>
              実機でテストするには、先に LINE の友だち追加が必要です。
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a
                href={friendAdd.add_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ textDecoration: "none", fontSize: 13 }}
              >
                友だち追加URLを開く
              </a>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, wordBreak: "break-all" }}>
              {friendAdd.add_url}
            </p>
          </div>

          {/* QR コード */}
          <div style={{ flexShrink: 0, textAlign: "center" }}>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>QRコードで追加</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=4&data=${encodeURIComponent(friendAdd.add_url)}`}
              alt="友だち追加QRコード"
              width={120}
              height={120}
              style={{ borderRadius: 8, border: "1px solid var(--border-light)", display: "block" }}
            />
          </div>
        </div>
      )}
    </>
  );
}
