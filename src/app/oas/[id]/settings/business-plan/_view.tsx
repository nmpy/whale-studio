"use client";

// src/app/oas/[id]/settings/business-plan/_view.tsx
// 法人契約・利用条件ページの本体（client）。
//
// 構成:
//   1. 現在の法人契約・利用条件（PlanCard variant="embedded" + 法人相談リンク）
//   2. 法人向けプラン（既存 /pricing の法人プランカードを embedded で再利用。各カードの
//      「相談する」が既存 FeedbackModal の法人相談フローを開く）
//
// - 法人利用 OA（usageType="business"）のみ意味を持つ。それ以外は契約なしの案内のみ。
// - 課金/Stripe/API/プラン判定には触らない（表示・既存導線の再利用のみ）。

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/Breadcrumb";
import { PlanCard } from "@/components/PlanCard";
import { PricingContent } from "@/app/pricing/_content";
import { oaApi, getDevToken } from "@/lib/api-client";

type PriceOverrides = React.ComponentProps<typeof PricingContent>["priceOverrides"];

export function SettingsBusinessPlanView({
  oaId,
  priceOverrides,
}: {
  oaId: string;
  priceOverrides: PriceOverrides;
}) {
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

      {/* ── 1. 現在の法人契約・利用条件 ── */}
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

      {/* ── 2. 法人向けプラン（既存 /pricing の法人プランカードを embedded で再利用） ──
          法人利用 OA のときのみ表示。各カードの「相談する」が法人相談 FeedbackModal を開く。 */}
      {isBusiness && (
        <section className="mt-6 border-t border-line pt-6">
          <h2 className="font-round mb-1 text-[18px] font-bold tracking-[-0.01em] text-ink">
            法人向けプラン
          </h2>
          <p className="mb-4 text-[12px] leading-[1.7] text-ink-3">
            法人向けの契約内容・利用条件は、導入規模や運用内容に応じてご案内しています。
          </p>
          <PricingContent
            embedded
            usageType="business"
            oaId={oaId}
            source="settings"
            priceOverrides={priceOverrides}
          />
        </section>
      )}
    </>
  );
}
