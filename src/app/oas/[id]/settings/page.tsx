"use client";

// src/app/oas/[id]/settings/page.tsx
// OA 設定ハブ — 機能カードを並べるだけ。フォームは /account へ移設。

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { oaApi, getDevToken } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";

// ── プランバッジ ──────────────────────────────────────────────────────────
// owner / admin 向けに現在プランをインライン表示するコンポーネント。
// GET /api/oas/:id/subscription から取得（fire-and-forget、エラー時は非表示）。

interface PlanInfo {
  name:          string;
  display_name:  string;
  max_works:     number;
  price_monthly: number;
}

function PlanBadge({ oaId }: { oaId: string }) {
  const [plan, setPlan] = useState<PlanInfo | null | "loading">("loading");

  useEffect(() => {
    fetch(`/api/oas/${oaId}/subscription`, {
      headers: { Authorization: `Bearer ${getDevToken()}` },
    })
      .then((r) => r.json())
      .then((d) => setPlan(d.plan ?? null))
      .catch(() => setPlan(null));
  }, [oaId]);

  if (plan === "loading" || plan === null) return null;

  const isFree      = plan.price_monthly === 0;
  const worksLabel  = plan.max_works === -1 ? "無制限" : `${plan.max_works} 件`;
  const priceLabel  = isFree ? "無料" : `¥${plan.price_monthly.toLocaleString()}/月`;

  return (
    <div style={{
      display:      "flex",
      alignItems:   "center",
      gap:          10,
      padding:      "10px 14px",
      background:   isFree ? "var(--color-primary-soft, #EAF4F1)" : "#f0fdf4",
      border:       `1px solid ${isFree ? "#b9ddd6" : "#86efac"}`,
      borderRadius: "var(--radius-md, 10px)",
      marginBottom: 20,
      fontSize:     13,
    }}>
      <span style={{ fontSize: 18 }}>{isFree ? "🔓" : "✅"}</span>
      <div style={{ flex: 1 }}>
        <span style={{ fontWeight: 700, color: "var(--color-primary, #2F6F5E)" }}>
          {plan.display_name}
        </span>
        <span style={{ marginLeft: 8, color: "var(--text-secondary, #6b7280)", fontSize: 12 }}>
          作品 {worksLabel}・{priceLabel}
        </span>
      </div>
      {isFree && (
        <Link
          href="/pricing"
          style={{
            fontSize: 11, fontWeight: 700, color: "var(--color-primary, #2F6F5E)",
            textDecoration: "none", padding: "4px 10px",
            border: "1px solid #b9ddd6", borderRadius: "var(--radius-full, 999px)",
            whiteSpace: "nowrap",
          }}
        >
          プランを見る →
        </Link>
      )}
    </div>
  );
}

const HUB_ITEM_DEFS = [
  {
    key:   "works",
    icon:  "📖",
    title: "作品管理",
    desc:  "謎解きシナリオの作成・編集・公開管理",
    color: "#06C755",
    bg:    "#E6F7ED",
  },
  {
    key:   "account",
    icon:  "⚙️",
    title: "アカウント情報",
    desc:  "アカウント名・メモ・接続ステータスを管理",
    color: "#4b5563",
    bg:    "#f3f4f6",
  },
  {
    key:   "richmenu-editor",
    icon:  "🗂",
    title: "リッチメニュー",
    desc:  "ユーザー画面下部のメニューをカスタマイズ",
    color: "#7c3aed",
    bg:    "#f5f3ff",
  },
  {
    key:   "friend-add",
    icon:  "👥",
    title: "友だち追加設定",
    desc:  "招待 URL・シェア用画像を管理",
    color: "#059669",
    bg:    "#f0fdf4",
  },
  {
    key:   "sns",
    icon:  "📢",
    title: "SNS 投稿管理",
    desc:  "投稿文・画像・掲載 URL を管理",
    color: "#d97706",
    bg:    "#fffbeb",
  },
  {
    key:   "trackings",
    icon:  "📊",
    title: "トラッキング管理",
    desc:  "流入元ごとのクリック数・ユーザー数を計測",
    color: "#2563eb",
    bg:    "#eff6ff",
  },
  {
    key:   "settings/members",
    icon:  "👤",
    title: "メンバー管理",
    desc:  "ワークスペースメンバーのロール（owner/admin/editor/viewer）を管理",
    color: "#dc2626",
    bg:    "#fef2f2",
  },
  {
    key:   "onboarding-analytics",
    icon:  "📈",
    title: "オンボーディング分析",
    desc:  "作品作成〜セットアップ完了の各ステップ到達率を確認（owner のみ）",
    color: "#7c3aed",
    bg:    "#f5f3ff",
  },
] as const;

export default function OaSettingsPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const { role, canEdit, isOwner, isAdmin } = useWorkspaceRole(oaId);
  const [oaTitle, setOaTitle] = useState<string>("");

  useEffect(() => {
    oaApi.get(getDevToken(), oaId)
      .then((oa) => setOaTitle(oa.title))
      .catch(() => {});
  }, [oaId]);

  return (
    <>
      <ViewerBanner role={role} />
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "設定" },
          ]} />
          <h2>アカウント設定</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            {oaTitle ? `${oaTitle} の各機能を管理します` : "このアカウントの機能を選択してください"}
          </p>
        </div>
      </div>

      {/* ── プランバッジ（owner / admin のみ） ── */}
      {(isOwner || isAdmin) && <PlanBadge oaId={oaId} />}

      {/* ── 機能カード グリッド ── */}
      <div>
        <p style={{
          fontSize: 12, fontWeight: 600, color: "#6b7280",
          textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12,
        }}>
          このアカウントの機能
        </p>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 12,
        }}>
          {HUB_ITEM_DEFS.filter(({ key }) => {
            if (key === "onboarding-analytics") return isOwner;
            if (key === "settings/members") return isOwner || isAdmin;
            if (key === "account" || key === "richmenu-editor" || key === "friend-add" || key === "sns") return isAdmin;
            return true; // works, trackings — visible to all
          }).map(({ key, icon, title, desc, color, bg }) => (
            <Link
              key={key}
              href={`/oas/${oaId}/${key}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "14px 16px",
                background: "#fff",
                border: "1px solid #e5e5e5",
                borderRadius: 10,
                textDecoration: "none",
                color: "inherit",
                transition: "border-color .15s, box-shadow .15s, transform .1s",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget;
                el.style.borderColor = color;
                el.style.boxShadow   = "0 2px 8px rgba(0,0,0,.08)";
                el.style.transform   = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget;
                el.style.borderColor = "#e5e5e5";
                el.style.boxShadow   = "none";
                el.style.transform   = "translateY(0)";
              }}
            >
              <span style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                borderRadius: 8,
                background: bg,
                fontSize: 18,
                flexShrink: 0,
              }}>
                {icon}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 2 }}>
                  {title}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.45 }}>
                  {desc}
                </div>
              </div>
              <span style={{
                marginLeft: "auto",
                fontSize: 14,
                color: "#9ca3af",
                flexShrink: 0,
                alignSelf: "center",
              }}>
                →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
