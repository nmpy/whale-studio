"use client";

// src/app/oas/[id]/settings/page.tsx
// OA 設定ハブ — 機能カードを並べるだけ。フォームは /account へ移設。

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { oaApi, getDevToken } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";
import { PlanCard } from "@/components/PlanCard";

const HUB_ITEM_DEFS = [
  {
    key:   "works",
    title: "作品管理",
    desc:  "謎解きシナリオの作成・編集・公開管理",
    color: "#06C755",
    bg:    "#E6F7ED",
  },
  {
    key:   "account",
    title: "アカウント情報",
    desc:  "アカウント名・メモ・接続ステータスを管理",
    color: "#4b5563",
    bg:    "#f3f4f6",
  },
  {
    key:   "richmenu-editor",
    title: "リッチメニュー",
    desc:  "ユーザー画面下部のメニューをカスタマイズ",
    color: "#7c3aed",
    bg:    "#f5f3ff",
  },
  {
    key:   "friend-add",
    title: "友だち追加設定",
    desc:  "招待 URL・シェア用画像を管理",
    color: "#059669",
    bg:    "#f0fdf4",
  },
  {
    key:   "sns",
    title: "SNS 投稿管理",
    desc:  "投稿文・画像・掲載 URL を管理",
    color: "#d97706",
    bg:    "#fffbeb",
  },
  {
    key:   "trackings",
    title: "トラッキング管理",
    desc:  "流入元ごとのクリック数・ユーザー数を計測",
    color: "#2563eb",
    bg:    "#eff6ff",
  },
  {
    key:   "settings/members",
    title: "メンバー管理",
    desc:  "ワークスペースメンバーのロール（owner/admin/editor/viewer）を管理",
    color: "#dc2626",
    bg:    "#fef2f2",
  },
  {
    key:   "onboarding-analytics",
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
  const [oaTitle,        setOaTitle]        = useState<string>("");
  const [billingSuccess, setBillingSuccess] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    oaApi.get(getDevToken(), oaId)
      .then((oa) => setOaTitle(oa.title))
      .catch(() => {});
  }, [oaId]);

  // billing=success クエリを検出してバナーを表示し、URL をクリーンアップ
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("billing") === "success") {
      setBillingSuccess(true);
      // URL から billing パラメータを除去（ページリロードなし）
      const url = new URL(window.location.href);
      url.searchParams.delete("billing");
      window.history.replaceState({}, "", url.toString());
      // 10 秒後に自動で消す
      timerRef.current = setTimeout(() => setBillingSuccess(false), 10_000);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // マウント時のみ実行
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <ViewerBanner role={role} />

      {/* ── Stripe Checkout 完了バナー ── */}
      {billingSuccess && (
        <div style={{
          display:      "flex",
          alignItems:   "flex-start",
          gap:          12,
          padding:      "14px 18px",
          background:   "#f0fdf4",
          border:       "1px solid #86efac",
          borderRadius: "var(--radius-md, 10px)",
          marginBottom: 16,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize:    13,
              fontWeight:  700,
              color:       "#166534",
              marginBottom: 3,
            }}>
              プランのアップグレードが完了しました！
            </p>
            <p style={{
              fontSize:   12,
              color:      "#15803d",
              lineHeight: 1.6,
              margin:     0,
            }}>
              editor プランへの移行が完了しました。作品の追加・本番公開が可能になっています。
            </p>
          </div>
          <button
            onClick={() => {
              setBillingSuccess(false);
              if (timerRef.current) clearTimeout(timerRef.current);
            }}
            style={{
              background: "none",
              border:     "none",
              cursor:     "pointer",
              color:      "#166534",
              fontSize:   18,
              lineHeight: 1,
              padding:    "2px 4px",
              flexShrink: 0,
            }}
            title="閉じる"
          >
            ×
          </button>
        </div>
      )}

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

      {/* ── プランカード（owner / admin のみ） ── */}
      {(isOwner || isAdmin) && <PlanCard oaId={oaId} />}

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
          }).map(({ key, title, desc, color }) => (
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
