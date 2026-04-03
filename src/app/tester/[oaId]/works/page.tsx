"use client";

// src/app/tester/[oaId]/works/page.tsx
//
// テスター用 作品リスト。
// 管理画面の /oas/[id]/works/page.tsx に対応するが、
// 遷移先が /tester/${oaId}/works/${workId} になり、
// 編集・削除・作品追加は非表示。

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { oaApi, workApi, friendAddApi, getDevToken, type WorkListItem } from "@/lib/api-client";
import type { FriendAddSettings } from "@/types";

const STATUS_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  draft:  { label: "下書き",  color: "#6b7280", bg: "#f3f4f6", dot: "#9ca3af" },
  active: { label: "公開中",  color: "#166534", bg: "#dcfce7", dot: "#22c55e" },
  paused: { label: "停止中",  color: "#92400e", bg: "#fef3c7", dot: "#f59e0b" },
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/* ── ワークカード ──────────────────────────────────────────────────── */
function WorkCard({ work, oaId }: { work: WorkListItem; oaId: string }) {
  const [hovered, setHovered] = useState(false);
  const st = STATUS_META[work.publish_status] ?? STATUS_META.draft;

  return (
    <div
      style={{
        background: "var(--surface)",
        border: `1px solid ${hovered ? "var(--gray-300)" : "var(--border-light)"}`,
        borderRadius: "var(--radius-md)",
        padding: "20px 22px",
        boxShadow: hovered ? "var(--shadow-md)" : "var(--shadow-xs)",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── ヘッダー行 ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        {/* 状態バッジ */}
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 11, fontWeight: 700,
          color: st.color, background: st.bg,
          padding: "3px 9px", borderRadius: "var(--radius-full)",
          whiteSpace: "nowrap", flexShrink: 0,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.dot, display: "inline-block" }} />
          {st.label}
        </span>

        {/* タイトル */}
        <Link
          href={`/tester/${oaId}/works/${work.id}`}
          style={{
            fontSize: 15, fontWeight: 700,
            color: "var(--text-primary)",
            textDecoration: "none",
            flex: 1,
            lineHeight: 1.3,
          }}
        >
          {work.title}
        </Link>

        {/* アクション */}
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          <Link
            href={`/tester/${oaId}/works/${work.id}`}
            className="btn btn-primary"
            style={{ padding: "5px 14px", fontSize: 12 }}
          >
            管理する
          </Link>
          <Link
            href={`/playground?work_id=${work.id}&oa_id=${oaId}`}
            className="btn btn-ghost"
            style={{ padding: "5px 12px", fontSize: 12 }}
          >
            ▶ テスト
          </Link>
        </div>
      </div>

      {/* ── メタ情報チップ ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[
          { icon: "👥", value: (work._count.userProgress ?? 0).toLocaleString(), label: "プレイヤー", highlight: (work._count.userProgress ?? 0) > 0 },
          { icon: "🗂",  value: work._count.phases,                         label: "フェーズ",     highlight: false },
          { icon: "💬", value: work._count.messages,                        label: "メッセージ",   highlight: false },
          { icon: "🎭", value: work._count.characters,                      label: "キャラクター", highlight: false },
        ].map((chip) => (
          <span key={chip.label} style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            fontSize: 11,
            color: chip.highlight ? "var(--color-info)" : "var(--text-secondary)",
            background: chip.highlight ? "#eff6ff" : "var(--gray-50)",
            border: `1px solid ${chip.highlight ? "#bfdbfe" : "var(--border-light)"}`,
            padding: "3px 10px",
            borderRadius: "var(--radius-full)",
          }}>
            <span>{chip.icon}</span>
            <strong style={{ fontWeight: 700 }}>{chip.value}</strong>
            <span style={{ color: "var(--text-muted)" }}>{chip.label}</span>
          </span>
        ))}

        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)", alignSelf: "center" }}>
          更新: {formatDate(work.updated_at)}
        </span>
      </div>
    </div>
  );
}

/* ── スケルトン ─────────────────────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border-light)",
      borderRadius: "var(--radius-md)",
      padding: "20px 22px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div className="skeleton" style={{ width: 56, height: 24, borderRadius: 12 }} />
        <div className="skeleton" style={{ width: 180, height: 18, flex: 1 }} />
        <div className="skeleton" style={{ width: 72, height: 30, borderRadius: 6 }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {[80, 70, 90, 90].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 24, borderRadius: 12 }} />
        ))}
      </div>
    </div>
  );
}

/* ── メインページ ────────────────────────────────────────────────────── */
export default function TesterWorkListPage() {
  const params = useParams<{ oaId: string }>();
  const oaId   = params.oaId;

  const [oaTitle, setOaTitle]     = useState("");
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
      .then(([oa, list, fa]) => {
        setOaTitle(oa.title);
        setWorks(list);
        setFriendAdd(fa);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [oaId]);

  const sorted      = [...works].sort((a, b) => a.sort_order - b.sort_order);
  const activeCount = works.filter((w) => w.publish_status === "active").length;

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: oaTitle || "テスターポータル", href: `/tester/${oaId}` },
            { label: "作品リスト" },
          ]} />
          <h2>作品リスト</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            {oaTitle ? `${oaTitle} の謎解きシナリオ` : "謎解きシナリオ"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/tester/${oaId}`} className="btn btn-ghost">
            ← アカウントリスト
          </Link>
        </div>
      </div>

      {/* ── テスターモード注意文 ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 14px",
        background: "#fffbeb",
        border: "1px solid #fde68a",
        borderRadius: "var(--radius-md)",
        marginBottom: 16,
        fontSize: 12, color: "#b45309",
      }}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>🔍</span>
        <span>テスターモード — 閲覧・テスト実行のみ可能です。編集・削除・作品追加は行えません。</span>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>
      )}

      {/* ── 統計サマリー ── */}
      {!loading && works.length > 0 && (
        <div style={{
          display: "flex", gap: 10, marginBottom: 20,
          padding: "14px 18px",
          background: "var(--surface)",
          border: "1px solid var(--border-light)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-xs)",
        }}>
          {[
            { label: "総作品数",     value: works.length,                                                                       color: "var(--text-primary)" },
            { label: "公開中",       value: activeCount,                                                                        color: "var(--color-success)" },
            { label: "総プレイヤー", value: works.reduce((s, w) => s + (w._count.userProgress ?? 0), 0).toLocaleString(),      color: "var(--color-info)" },
          ].map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 18, borderRight: "1px solid var(--border-light)" }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── コンテンツ ── */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : sorted.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🎭</div>
            <p className="empty-state-title">作品がまだありません</p>
            <p className="empty-state-desc">管理者が作品を作成すると、ここに表示されます。</p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sorted.map((w) => (
            <WorkCard key={w.id} work={w} oaId={oaId} />
          ))}
          <div style={{ textAlign: "right", fontSize: 11, color: "var(--text-muted)", paddingTop: 4 }}>
            全 {works.length} 件
          </div>
        </div>
      )}

      {/* ── 友だち追加 ── */}
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
          <div style={{ flex: 1, minWidth: 180 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5 }}>
              🔗 友だち追加
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
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
            <p style={{ fontSize: 11, color: "var(--text-muted)", wordBreak: "break-all" }}>
              {friendAdd.add_url}
            </p>
          </div>
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
