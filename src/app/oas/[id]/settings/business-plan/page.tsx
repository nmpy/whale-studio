"use client";

// src/app/oas/[id]/settings/business-plan/page.tsx
// アカウント設定 > 法人契約・利用条件 ページ。
// 個人向け /settings/plan と同じ構造。売り込みではなく「契約内容・利用条件の確認」として見せる。
//
// - 法人利用 OA（usageType="business"）のみ意味を持つ。それ以外は契約なしの案内のみ表示。
// - 契約/プラン情報は PlanCard variant="embedded" を再利用（subscription 由来の
//   プラン名 / β版・トライアル / 作品数上限 / プレイヤー上限 / 期間。値・算出は不変）。
// - 問い合わせ導線は既存の法人相談フロー（FeedbackModal）を再利用：
//   open-feedback-modal イベントを dispatch（AppHeader が listen）。控えめな text link。
// - PlanCard 自体が owner/admin 以外には null を返す（API gate）ため、追加ガードは設けない。
// - 課金/Stripe/API/プラン判定には触らない（表示・導線のみ）。

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { PlanCard } from "@/components/PlanCard";
import { oaApi, getDevToken } from "@/lib/api-client";

export default function SettingsBusinessPlanPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;

  const [usageType, setUsageType] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    oaApi.get(getDevToken(), oaId)
      .then((oa) => setUsageType(oa.usage_type ?? "personal"))
      .catch(() => setUsageType(null))
      .finally(() => setLoaded(true));
  }, [oaId]);

  const isBusiness = usageType === "business";

  // 法人相談（既存 FeedbackModal の法人相談モード）を開く。AppHeader が listen している。
  function openBusinessInquiry() {
    window.dispatchEvent(
      new CustomEvent("open-feedback-modal", { detail: { pricingSource: "settings" } }),
    );
  }

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="mb-5">
        <Breadcrumb items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "設定",            href: `/oas/${oaId}/settings` },
          { label: "法人契約・利用条件" },
        ]} />
        <h2 className="font-round mt-1 text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
          法人契約・利用条件
        </h2>
        <p className="mt-1 text-[12px] text-ink-3">
          法人向けの契約内容と利用条件を確認できます。
        </p>
      </div>

      <section className="rounded-card border border-line bg-surface px-4 py-4 sm:px-5 sm:py-5">
        <div className="mb-3 flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
            現在の法人契約
          </p>
          {isBusiness && (
            <span className="inline-flex items-center rounded border border-brand/30 bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold text-brand-ink">
              法人利用
            </span>
          )}
        </div>

        {/* 法人利用 OA は契約プラン情報を表示。それ以外は契約なしの案内。 */}
        {!loaded ? (
          <p className="text-[12px] text-ink-3">読み込み中...</p>
        ) : isBusiness ? (
          <>
            {/* 契約プラン情報（PlanCard 流用・embedded）。owner/admin 以外は null。 */}
            <PlanCard oaId={oaId} variant="embedded" />

            <div className="mt-4 border-t border-line pt-3.5">
              <p className="mb-2 text-[12px] leading-[1.7] text-ink-2">
                契約内容・利用条件についてのご確認やご相談を承っています。
                <br />
                契約変更・追加のご相談は、下記からお問い合わせください。
              </p>
              <button
                type="button"
                onClick={openBusinessInquiry}
                className="inline-flex items-center gap-1 bg-transparent p-0 text-[12px] font-semibold text-brand-ink no-underline transition-colors hover:underline"
              >
                法人契約について相談する
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </>
        ) : (
          <p className="text-[12px] leading-[1.7] text-ink-2">
            このアカウントは法人契約ではありません。
            <br />
            法人利用のご相談は、運営までお問い合わせください。
          </p>
        )}
      </section>
    </>
  );
}
