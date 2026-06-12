// src/app/oas/[id]/settings/business-plan/page.tsx
// アカウント設定 > 法人契約・利用条件 ページ（Server Component）。
// 個人向け /settings/plan と同じ構造（現在契約 + 料金/法人プラン比較）。
//
// 価格は /pricing と同じく Stripe Price から server-side 取得（fetchAllPlanPrices）し、
// client view（SettingsBusinessPlanView）へ渡す。現在契約の表示と法人相談導線は view 側。
// 課金/Stripe/API/プラン判定ロジックには触らない（表示・既存導線の再利用のみ）。

import { SettingsBusinessPlanView } from "./_view";
import { fetchAllPlanPrices } from "@/lib/stripe-price-display";

export const dynamic = "force-dynamic";

export default async function SettingsBusinessPlanPage({ params }: { params: { id: string } }) {
  const oaId = params.id;
  const priceOverrides = await fetchAllPlanPrices();
  return <SettingsBusinessPlanView oaId={oaId} priceOverrides={priceOverrides} />;
}
