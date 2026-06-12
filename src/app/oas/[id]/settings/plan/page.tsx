// src/app/oas/[id]/settings/plan/page.tsx
// アカウント設定 > プラン・利用条件 ページ（Server Component）。
// 「このアカウントの機能」グリッドの 1 カードからの遷移先。
//
// 構成:
//   1. 現在のご利用プラン（PlanCard variant="embedded" を再利用）
//   2. 料金プラン（既存 /pricing の個人プランカードを embedded で再利用）
//
// - 料金プランは PricingContent を embedded モードで再利用（既存カード・現在プラン badge・
//   checkout 挙動・レスポンシブをそのまま使用）。usageType="personal" で個人カードのみ表示。
// - 価格は /pricing と同じく Stripe Price から server-side 取得（fetchAllPlanPrices）。
// - 課金/Stripe/API/プラン判定ロジックには触らない（表示・既存導線の再利用のみ）。

import { Breadcrumb } from "@/components/Breadcrumb";
import { PlanCard } from "@/components/PlanCard";
import { PricingContent } from "@/app/pricing/_content";
import { fetchAllPlanPrices } from "@/lib/stripe-price-display";

// Stripe Price を毎リクエスト取得するため dynamic 明示（/pricing と同方針）。
export const dynamic = "force-dynamic";

export default async function SettingsPlanPage({ params }: { params: { id: string } }) {
  const oaId = params.id;
  const priceOverrides = await fetchAllPlanPrices();

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

      {/* ── 1. 現在のご利用プラン（ページ内カード） ── */}
      <section className="rounded-card border border-line bg-surface px-4 py-4 sm:px-5 sm:py-5">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
          現在のご利用プラン
        </p>
        {/* owner/admin 以外 / 未契約のときは PlanCard が null を返す（API gate）。 */}
        <PlanCard oaId={oaId} variant="embedded" />
      </section>

      {/* ── 2. 料金プラン（既存 /pricing の個人プランカードを embedded で再利用） ── */}
      <section className="mt-6">
        <h2 className="font-round mb-1 text-[18px] font-bold tracking-[-0.01em] text-ink">
          料金プラン
        </h2>
        <p className="mb-4 text-[12px] leading-[1.7] text-ink-3">
          現在のご利用状況と比較しながら、ご自身のペースでご検討ください。
        </p>
        <PricingContent
          embedded
          usageType="personal"
          oaId={oaId}
          source="settings"
          priceOverrides={priceOverrides}
        />
      </section>
    </>
  );
}
