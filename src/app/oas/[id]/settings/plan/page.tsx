"use client";

// src/app/oas/[id]/settings/plan/page.tsx
// アカウント設定 > プラン・利用条件 ページ。
// 「このアカウントの機能」グリッドの 1 カードからの遷移先。売り込みではなく
// 現在のご利用プラン・利用条件の確認として落ち着いて見せる。
//
// - 現在プラン情報は PlanCard variant="embedded" を再利用（subscription 由来の
//   既存の値・算出ロジック・β版/トライアル表示・表示確認モード挙動をそのまま使用）。
// - 料金導線は控えめな text link（buildPricingUrl）。大きな CTA / 営業表現は使わない。
// - PlanCard 自体が owner/admin 以外には null を返す（API gate）ため、追加のガードは設けない。

import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { PlanCard } from "@/components/PlanCard";
import { buildPricingUrl } from "@/lib/pricing-url";

export default function SettingsPlanPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="mb-5">
        <Breadcrumb items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "設定",            href: `/oas/${oaId}/settings` },
          { label: "プラン・利用条件" },
        ]} />
        <h2 className="font-round mt-1 text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
          プラン・利用条件
        </h2>
        <p className="mt-1 text-[12px] text-ink-3">
          現在のご利用プランと利用条件を確認できます。
        </p>
      </div>

      {/* ── 現在のご利用プラン（ページ内カード） ── */}
      <section className="rounded-card border border-line bg-surface px-4 py-4 sm:px-5 sm:py-5">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
          現在のご利用プラン
        </p>

        {/* 現在プラン情報（PlanCard 流用・embedded）。
            owner/admin 以外 / 未契約のときは PlanCard が null を返すため、その場合は補足のみ表示。 */}
        <PlanCard oaId={oaId} variant="embedded" />

        <div className="mt-4 border-t border-line pt-3.5">
          <p className="mb-2 text-[12px] leading-[1.7] text-ink-2">
            現在利用できる機能やプランごとの条件を確認できます。
            <br />
            必要に応じて、料金・プランページで詳細をご確認ください。
          </p>
          <Link
            href={buildPricingUrl({ source: "settings", oaId })}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-ink no-underline transition-colors hover:underline"
          >
            料金・プランを確認する
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </>
  );
}
