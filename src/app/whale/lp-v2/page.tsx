// src/app/whale/lp-v2/page.tsx
//
// Whale Studio (SaaS) 新 LP — Preview 確認用ルート。
//
// - 既存トップページ (src/app/page.tsx) は変更していない。切り替えは別途判断する。
// - 5 セクション (Hero / Features / How it works / Pricing / CTA) + Footer。
// - Server Component。state を持たず、DB / API も叩かないため完全に静的に描画できる。
// - layout.tsx でブランド専用トークンと metadata を流し込んでいる。
// - AppShell.tsx 側で /whale/* は CMS ヘッダー / container を bypass 済み。

import { Hero }        from "@/components/whale/lp-v2/Hero";
import { Features }    from "@/components/whale/lp-v2/Features";
import { HowItWorks }  from "@/components/whale/lp-v2/HowItWorks";
import { Pricing }     from "@/components/whale/lp-v2/Pricing";
import { Cta }         from "@/components/whale/lp-v2/Cta";
import { Footer }      from "@/components/whale/lp-v2/Footer";

export default function WhaleStudioLpV2Page() {
  return (
    <>
      <Hero />
      <Features />
      <HowItWorks />
      <Pricing />
      <Cta />
      <Footer />
    </>
  );
}
