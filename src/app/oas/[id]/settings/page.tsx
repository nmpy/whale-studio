"use client";

// src/app/oas/[id]/settings/page.tsx
// OA 設定ハブ — 機能カードを並べるだけ。フォームは /account / /richmenu-editor 等の各サブページに移設済。
// Phase 1.4 ではこのハブの見た目を Phase 0 トークンに揃える。
// (※ フォーム/Accordion/危険操作 等は本ページに存在しないため、それらは適用対象外)

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { oaApi, getDevToken } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";
import { QuotaUsageCard } from "./_quota-usage-card";

/** ハブに並べる機能カード定義。
 *  Phase 1.4 で per-feature の vivid color を削除し、見た目を uniform に揃える
 *  (ガイド §1.1「brand 緑は主役アクション専用 / 多用しない」 / §1.5「装飾を盛らず…」)。
 *  カードのアクセントは hover 時の brand 左バー 1 つに集約。 */
const HUB_ITEM_DEFS = [
  { key: "works",                title: "作品管理",         desc: "作品シナリオの作成・編集・公開管理" },
  // アカウント情報に LIFF設定を統合（旧「LIFF設定」カードはここに集約）。
  { key: "account",              title: "アカウント情報",   desc: "アカウント名・接続ステータス・LIFF設定を管理" },
  { key: "richmenu-editor",      title: "リッチメニュー",   desc: "ユーザー画面下部のメニューをカスタマイズ" },
  // 「ビーコン管理」はロケーション配下に導線があるため設定ハブからは除外。
  // 「トラッキング管理」はオーディエンス配下で登録・閲覧できるため設定ハブからは除外。
  { key: "friend-add",           title: "友だち追加設定",   desc: "招待 URL・シェア用画像を管理" },
  // 「SNS投稿管理」→「X投稿管理」として作品詳細配下（/oas/[id]/works/[workId]/x-posts）へ移設。設定ハブからは除外。
  { key: "settings/members",     title: "メンバー管理",     desc: "ワークスペースメンバーのロール（owner/admin/editor/viewer）を管理" },
  // 「オンボーディング分析」は設定ハブからは除外。
  // 現在のプラン・利用条件の確認導線（owner / admin）。売り込みではなく設定情報の確認として並べる。
  { key: "settings/plan",        title: "プラン・利用条件",   desc: "現在のご利用プランと利用条件を確認" },
  // 法人契約・利用条件の確認導線（法人利用 OA かつ owner / admin のときのみ表示）。
  { key: "settings/business-plan", title: "法人契約・利用条件", desc: "法人向けの契約内容・利用条件を確認" },
  // Whale Studio Live（隠し上位機能）。Live にアクセス可能なユーザーにのみ表示する。
  { key: "live",                 title: "Whale Studio Live", desc: "リアルタイムに進行・管制・演出支援を行う上位機能" },
] as const;

export default function OaSettingsPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const { role, isOwner, isAdmin, liveAccess } = useWorkspaceRole(oaId);
  const [oaTitle,        setOaTitle]        = useState<string>("");
  const [usageType,      setUsageType]      = useState<string | null>(null);
  const [billingSuccess, setBillingSuccess] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    oaApi.get(getDevToken(), oaId)
      .then((oa) => { setOaTitle(oa.title); setUsageType(oa.usage_type ?? "personal"); })
      .catch(() => {});
  }, [oaId]);

  // billing=success クエリを検出してバナーを表示し、URL をクリーンアップ。
  // 注: 現在の Stripe Checkout の success_url は /billing/success（反映確認 UX）へ遷移するため、
  //     この ?billing=success バナーは通常の checkout フローでは配線されていない（dead path）。
  //     Customer Portal 等の別導線で復活させる場合に備えて残置（不要なら将来削除候補）。
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
        <div
          role="status"
          className="mb-4 flex items-start gap-3 rounded-field border border-brand/30 bg-brand-soft px-4 py-3.5"
        >
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[13px] font-bold text-brand-ink">
              プランのアップグレードが完了しました！
            </p>
            <p className="text-[12px] leading-[1.6] text-brand-ink/85">
              editor プランへの移行が完了しました。作品の追加・本番公開が可能になっています。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setBillingSuccess(false);
              if (timerRef.current) clearTimeout(timerRef.current);
            }}
            title="閉じる"
            aria-label="バナーを閉じる"
            className="flex-shrink-0 cursor-pointer rounded-full px-1.5 py-0.5 text-[18px] leading-none text-brand-ink/70 transition-colors hover:bg-brand/10 hover:text-brand-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            ×
          </button>
        </div>
      )}

      {/* ── ページヘッダー ── */}
      <div className="mb-5">
        <Breadcrumb items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "設定" },
        ]} />
        <h2 className="font-round mt-1 text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
          設定
        </h2>
        <p className="mt-1 text-[12px] text-ink-3">
          {oaTitle ? `${oaTitle} の各機能を管理します` : "このアカウントの機能を選択してください"}
        </p>
      </div>

      {/* 上段の大きな現在プランカードは廃止。現在プラン情報は下部「プラン・利用条件」
          アコーディオン内（デフォルト閉じ）へ移設し、売り込み感を抑える。 */}

      {/* 月間メッセージ使用状況（push 通数）。時間差メッセージ = push の通数消費を可視化。 */}
      <QuotaUsageCard oaId={oaId} />

      {/* ── 機能カード グリッド ── */}
      <section>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
          このアカウントの機能
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {HUB_ITEM_DEFS.filter(({ key }) => {
            // 個人プランカードは「個人 OA（= 法人以外）」かつ owner/admin のみ。
            // 法人 OA では「法人契約・利用条件」カードに一本化（二重導線を避ける）。
            if (key === "settings/plan") return (isOwner || isAdmin) && usageType !== "business";
            // 法人契約カードは法人利用 OA かつ owner/admin のときのみ表示。
            if (key === "settings/business-plan") return (isOwner || isAdmin) && usageType === "business";
            // メンバー管理は管理者（owner / admin）のみ表示。
            if (key === "settings/members") return isOwner || isAdmin;
            if (key === "account" || key === "richmenu-editor" || key === "friend-add") return isAdmin;
            if (key === "live") return liveAccess; // Live 可ユーザーのみ。それ以外には存在を見せない
            return true; // works — visible to all
          }).map(({ key, title, desc }) => (
            <Link
              key={key}
              href={`/oas/${oaId}/${key}`}
              className="group relative flex items-start gap-3 overflow-hidden rounded-card border border-line bg-surface px-4 py-3.5 no-underline transition-all duration-150 hover:-translate-y-px hover:border-brand/30 hover:shadow-card"
            >
              {/* 左端 brand アクセントバー (= hover 時のみ可視) */}
              <span
                aria-hidden="true"
                className="absolute left-0 top-0 h-full w-[3px] bg-brand opacity-0 transition-opacity group-hover:opacity-100"
              />
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 text-[13px] font-semibold text-ink">{title}</div>
                <div className="text-[11px] leading-[1.45] text-ink-3">{desc}</div>
              </div>
              <span
                aria-hidden="true"
                className="ml-auto flex-shrink-0 self-center text-[14px] text-ink-3 transition-colors group-hover:text-brand-ink"
              >
                →
              </span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
