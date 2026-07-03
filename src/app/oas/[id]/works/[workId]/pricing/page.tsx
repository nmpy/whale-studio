// src/app/oas/[id]/works/[workId]/pricing/page.tsx
//
// 作品配下（in-layout）で開く「利用プラン」。中身は /pricing の PricingContent を再利用する。
// 作品 layout 配下に置くことで左サイドバーを維持し、サイドバーの「利用プラン」が active になる。
//   - 利用区分（個人/法人）は URL query ではなく **この作品の OA（params.id）** から解決する
//     （resolveOaUsageType）。→ 法人 OA では「法人利用プラン」、個人 OA では「個人利用プラン」。
//   - 課金/Stripe/プラン判定ロジックには触らない（既存 content の再利用のみ）。新規 API / DB なし。

import { Suspense } from "react";
import { PricingContent } from "@/app/pricing/_content";
import { fetchAllPlanPrices } from "@/lib/stripe-price-display";
import { resolveOaUsageType } from "@/lib/resolve-oa-usage-type";

export const dynamic = "force-dynamic";

export default async function WorkPricingPage({ params }: { params: { id: string; workId: string } }) {
  const oaId = params.id;
  const [priceOverrides, usageType] = await Promise.all([
    fetchAllPlanPrices(),
    resolveOaUsageType(oaId),
  ]);

  return (
    <Suspense fallback={null}>
      <PricingContent
        source="work_sidebar"
        oaId={oaId}
        priceOverrides={priceOverrides}
        usageType={usageType}
      />
    </Suspense>
  );
}
