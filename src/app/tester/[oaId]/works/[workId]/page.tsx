"use client";

// src/app/tester/[oaId]/works/[workId]/page.tsx
//
// テスター用 作品ハブ。
// 管理画面 (/oas/[id]/works/[workId]) と同じ機能カードを表示するが、
// パンくずが OA リストを指さないようになっている。
//
// 各機能ページ（シナリオ・メッセージ等）は /oas/ 配下の既存ページを利用する（β版）。

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { workApi, oaApi, getDevToken } from "@/lib/api-client";
import type { WorkListItem } from "@/lib/api-client";
import { HelpAccordion } from "@/components/HelpAccordion";

const STATUS_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  draft:  { label: "下書き", color: "#6b7280", bg: "#f3f4f6", dot: "#9ca3af" },
  active: { label: "公開中", color: "#166534", bg: "#dcfce7", dot: "#22c55e" },
  paused: { label: "停止中", color: "#92400e", bg: "#fef3c7", dot: "#f59e0b" },
};

// 各機能カードの定義（href は tester URL → next.config rewrite で /oas/ ページへ）
function hubCards(oaId: string, workId: string) {
  const base = `/tester/${oaId}/works/${workId}`;
  return [
    { key: "scenario",   icon: "🗺",  title: "シナリオフロー", desc: "フェーズ間の遷移フローを確認・編集します",                       color: "#059669", bg: "#ecfdf5", href: `${base}/scenario` },
    { key: "messages",   icon: "💬", title: "メッセージ・謎",  desc: "フェーズごとに送信するメッセージ・謎チャレンジを管理します",    color: "#06C755", bg: "#E6F7ED", href: `${base}/messages` },
    { key: "phases",     icon: "🗂",  title: "フェーズ管理",   desc: "シナリオの進行段階（フェーズ）を管理します",                     color: "#d97706", bg: "#fffbeb", href: `${base}/phases` },
    { key: "characters", icon: "👤", title: "キャラクター",    desc: "メッセージ送信者となるキャラクターを管理します",                 color: "#7c3aed", bg: "#f5f3ff", href: `${base}/characters` },
    { key: "dashboard",  icon: "📊", title: "ダッシュボード",  desc: "プレイ統計・リアルタイム・フロー分析を確認します",               color: "#0891b2", bg: "#ecfeff", href: `${base}/dashboard` },
    { key: "edit",       icon: "📝", title: "作品情報",        desc: "タイトル・説明・公開ステータス・あいさつメッセージを編集します", color: "#374151", bg: "#f9fafb", href: `${base}/edit` },
  ] as const;
}

export default function TesterWorkHubPage() {
  const params = useParams<{ oaId: string; workId: string }>();
  const oaId   = params.oaId;
  const workId = params.workId;

  const [oaTitle, setOaTitle] = useState("");
  const [work, setWork]       = useState<WorkListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    const token = getDevToken();
    Promise.all([
      oaApi.get(token, oaId),
      workApi.get(token, workId),
    ])
      .then(([oa, w]) => {
        setOaTitle(oa.title);
        setWork(w);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [oaId, workId]);

  if (loading) {
    return (
      <div className="page-header">
        <div>
          <div className="skeleton" style={{ width: 200, height: 13, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 280, height: 22 }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <>
        <div className="page-header">
          <h2>作品</h2>
          <Link href={`/tester/${oaId}`} className="btn btn-ghost">← 作品リストに戻る</Link>
        </div>
        <div className="alert alert-error">{error}</div>
      </>
    );
  }

  const statusMeta = STATUS_META[work?.publish_status ?? "draft"];
  const cards      = hubCards(oaId, workId);

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          {/* パンくず: OA リストへの導線なし → テスターホームへ */}
          <Breadcrumb items={[
            { label: oaTitle || "テスターポータル", href: `/tester/${oaId}` },
            ...(work ? [{ label: work.title }] : []),
          ]} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ margin: 0 }}>{work?.title ?? "作品"}</h2>
            {statusMeta && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "3px 10px", borderRadius: "var(--radius-full)",
                fontSize: 11, fontWeight: 700,
                background: statusMeta.bg, color: statusMeta.color,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusMeta.dot, display: "inline-block" }} />
                {statusMeta.label}
              </span>
            )}
          </div>
          {work?.description && (
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{work.description}</p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            href={`/playground?work_id=${workId}&oa_id=${oaId}`}
            className="btn btn-ghost"
          >
            ▶ テスト
          </Link>
          <Link href={`/tester/${oaId}`} className="btn btn-ghost">
            ← 作品リスト
          </Link>
        </div>
      </div>

      {/* ── ガイド ── */}
      <HelpAccordion items={[
        { icon: "✅", title: "この画面でできること", points: [
          "シナリオを構成するキャラクター・フェーズ・メッセージをまとめて管理できます",
          "公開ステータスの変更や、テスト実行への起点になります",
        ]},
        { icon: "👆", title: "まず最初に決めること", points: [
          "① キャラクターを作成（送信者の名前・アイコン）",
          "② フェーズを作成（開始・通常・エンディング）",
          "③ メッセージを追加してフェーズに紐づける",
          "④ シナリオフローで遷移（分岐）を設定する",
        ]},
      ]} />

      {/* ── カウント ── */}
      {work && (
        <div style={{
          display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap",
          padding: "14px 18px",
          background: "var(--surface)",
          border: "1px solid var(--border-light)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-xs)",
        }}>
          {[
            { label: "プレイヤー",   value: (work._count.userProgress ?? 0).toLocaleString(), icon: "👥", highlight: (work._count.userProgress ?? 0) > 0 },
            { label: "キャラクター", value: work._count.characters, icon: "🎭", highlight: false },
            { label: "フェーズ",     value: work._count.phases,     icon: "🗂",  highlight: false },
            { label: "メッセージ",   value: work._count.messages,   icon: "💬", highlight: false },
          ].map((chip) => (
            <div key={chip.label} style={{
              display: "flex", alignItems: "center", gap: 6,
              paddingRight: 18, borderRight: "1px solid var(--border-light)",
            }}>
              <span style={{ fontSize: 16 }}>{chip.icon}</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: chip.highlight ? "var(--color-info)" : "var(--text-primary)" }}>
                {chip.value}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{chip.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── 機能カードグリッド ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 14,
      }}>
        {cards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            style={{
              display: "block",
              padding: "20px 22px",
              background: card.bg,
              border: "1.5px solid transparent",
              borderRadius: "var(--radius-md)",
              textDecoration: "none",
              transition: "border-color 0.15s, box-shadow 0.15s",
              boxShadow: "var(--shadow-xs)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = card.color + "44";
              e.currentTarget.style.boxShadow   = "var(--shadow-md)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "transparent";
              e.currentTarget.style.boxShadow   = "var(--shadow-xs)";
            }}
          >
            <div style={{ fontSize: 26, marginBottom: 8 }}>{card.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: card.color, marginBottom: 4 }}>
              {card.title}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {card.desc}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
