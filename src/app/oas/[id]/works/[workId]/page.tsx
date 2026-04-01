"use client";

// src/app/oas/[id]/works/[workId]/page.tsx
// 作品ハブ — 各管理機能へのナビゲーション

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { workApi, oaApi, getDevToken } from "@/lib/api-client";
import type { WorkListItem } from "@/lib/api-client";
import { HelpAccordion } from "@/components/HelpAccordion";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";

// ── ステータス表示 ───────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  draft:  { label: "下書き", color: "#6b7280", bg: "#f3f4f6" },
  active: { label: "公開中", color: "#16a34a", bg: "#dcfce7" },
  paused: { label: "停止中", color: "#d97706", bg: "#fef3c7" },
};

// ── ハブカード定義 ────────────────────────────────────────
const HUB_CARDS = [
  {
    key: "edit",
    icon: "📝",
    title: "作品情報",
    desc: "タイトル・説明・公開ステータス・あいさつメッセージを編集します",
    color: "#374151",
    bg: "#f9fafb",
  },
  {
    key: "characters",
    icon: "👤",
    title: "キャラクター",
    desc: "メッセージ送信者となるキャラクターを管理します",
    color: "#7c3aed",
    bg: "#f5f3ff",
  },
  {
    key: "messages",
    icon: "💬",
    title: "メッセージ",
    desc: "フェーズごとに送信するメッセージを管理します",
    color: "#06C755",
    bg: "#E6F7ED",
  },
  {
    key: "riddles",
    icon: "🔍",
    title: "謎",
    desc: "Bot が出題する謎（問題）を管理します",
    color: "#dc2626",
    bg: "#fef2f2",
  },
  {
    key: "scenario",
    icon: "🗺",
    title: "シナリオフロー",
    desc: "フェーズ間の遷移フローを確認・編集します",
    color: "#059669",
    bg: "#ecfdf5",
  },
  {
    key: "phases",
    icon: "🗂",
    title: "フェーズ管理",
    desc: "シナリオの進行段階（フェーズ）を管理します",
    color: "#d97706",
    bg: "#fffbeb",
  },
  {
    key: "audience",
    icon: "🎯",
    title: "オーディエンス",
    desc: "プレイ統計・リアルタイム・フロー・セグメント・トラッキングを確認します",
    color: "#0891b2",
    bg: "#ecfeff",
  },
] as const;

// ── コンポーネント ────────────────────────────────────────
export default function WorkHubPage() {
  const params = useParams<{ id: string; workId: string }>();
  const oaId   = params.id;
  const workId = params.workId;
  const { role } = useWorkspaceRole(oaId);

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
          <Link href={`/oas/${oaId}/works`} className="btn btn-ghost">← 作品リストに戻る</Link>
        </div>
        <div className="alert alert-error">{error}</div>
      </>
    );
  }

  const statusMeta = STATUS_META[work?.publish_status ?? "draft"];

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            ...(oaTitle ? [{ label: oaTitle, href: `/oas/${oaId}/works` }] : []),
            ...(work ? [{ label: work.title }] : []),
          ]} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ margin: 0 }}>{work?.title ?? "作品"}</h2>
            {statusMeta && (
              <span style={{
                display: "inline-block", padding: "2px 8px", borderRadius: 12,
                fontSize: 11, fontWeight: 600,
                background: statusMeta.bg, color: statusMeta.color,
              }}>
                {statusMeta.label}
              </span>
            )}
          </div>
          {work?.description && (
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
              {work.description}
            </p>
          )}
        </div>
        <Link
          href={`/playground?work_id=${workId}&oa_id=${oaId}`}
          className="btn btn-ghost"
        >
          ▶ テスト
        </Link>
      </div>

      {/* ── 閲覧専用バナー ── */}
      <ViewerBanner role={role} />

      {/* ── 使い方ガイド ── */}
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
        { icon: "⚠️", title: "注意点", points: [
          "公開ステータスが「公開中」のときだけ LINE からのメッセージに反応します",
          "公開前に必ずプレイグラウンドでテスト動作を確認してください",
        ]},
      ]} />

      {/* ── カウント表示 ── */}
      {work && (
        <div style={{
          display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap",
        }}>
          {[
            { label: "キャラクター", value: work._count.characters },
            { label: "フェーズ",     value: work._count.phases },
            { label: "メッセージ",   value: work._count.messages },
          ].map(({ label, value }) => (
            <div key={label} style={{
              background: "#fff", border: "1px solid #e5e5e5", borderRadius: 8,
              padding: "10px 18px", display: "flex", flexDirection: "column",
              alignItems: "center", gap: 2, minWidth: 80,
            }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{value}</span>
              <span style={{ fontSize: 11, color: "#6b7280" }}>{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── ハブカード ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 16,
      }}>
        {HUB_CARDS.map((card) => (
          <Link
            key={card.key}
            href={`/oas/${oaId}/works/${workId}/${card.key}`}
            style={{ textDecoration: "none" }}
          >
            <div
              className="card"
              style={{
                padding: "20px 22px",
                cursor: "pointer",
                transition: "box-shadow 0.15s, transform 0.1s",
                display: "flex",
                alignItems: "flex-start",
                gap: 16,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
                (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = "";
                (e.currentTarget as HTMLDivElement).style.transform = "";
              }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                background: card.bg, display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 22,
              }}>
                {card.icon}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, color: card.color, marginBottom: 4 }}>
                  {card.title}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                  {card.desc}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
