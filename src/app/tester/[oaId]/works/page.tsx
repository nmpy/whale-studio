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
import { WorkCard } from "@/components/WorkCard";
import { FriendAddSection } from "@/components/FriendAddSection";
import { TesterBanner } from "@/components/TesterBanner";
import { oaApi, workApi, friendAddApi, getDevToken, type WorkListItem } from "@/lib/api-client";
import type { FriendAddSettings } from "@/types";

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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = getDevToken();
      const [oa, list, fa] = await Promise.all([
        oaApi.get(token, oaId),
        workApi.list(token, oaId),
        friendAddApi.get(token, oaId).catch(() => null),
      ]);
      setOaTitle(oa.title);
      setWorks(list);
      setFriendAdd(fa);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [oaId]);

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
            {oaTitle ? `${oaTitle} の謎解きシナリオを管理します` : "謎解きシナリオを管理します"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/tester/${oaId}`} className="btn btn-ghost">
            ← アカウントリスト
          </Link>
        </div>
      </div>

      {/* ── テスターモード注意文 ── */}
      <TesterBanner compact />

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {error}
          <button onClick={load} style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: "inherit" }}>
            再読み込み
          </button>
        </div>
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
            { label: "総プレイヤー数", value: works.reduce((s, w) => s + (w._count.userProgress ?? 0), 0).toLocaleString(),     color: "var(--color-info)" },
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
          <SkeletonCard />
        </div>
      ) : sorted.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🎭</div>
            <p className="empty-state-title">作品がまだありません</p>
            <p className="empty-state-desc">
              作品を追加してみましょう。シナリオ・メッセージ・フェーズをここから管理できます。
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sorted.map((w) => (
            <WorkCard
              key={w.id}
              work={w}
              oaId={oaId}
              basePath={`/tester/${oaId}/works`}
            />
          ))}
          <div style={{ textAlign: "right", fontSize: 11, color: "var(--text-muted)", paddingTop: 4 }}>
            全 {works.length} 件
          </div>
        </div>
      )}

      {/* ── 友だち追加 ── */}
      {!loading && friendAdd?.add_url && (
        <FriendAddSection addUrl={friendAdd.add_url} />
      )}
    </>
  );
}
