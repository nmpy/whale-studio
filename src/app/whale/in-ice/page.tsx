// src/app/whale/in-ice/page.tsx
//
// 「Whale in Ice / 氷のくじら」ブランドサイト本体。
// 6 セクション (Hero / About / Services / Works / Studio Connection / Contact) + Footer。
// 重い state は持たず、各セクションが自分の見た目を完結する構成。
//
// AppShell.tsx 側で /whale/* は CMS ヘッダー / container を bypass 済み。
// layout.tsx 側でブランド専用 metadata と CSS 変数を流し込んでいる。

import { Hero }              from "@/components/whale/in-ice/Hero";
import { About }             from "@/components/whale/in-ice/About";
import { Services }          from "@/components/whale/in-ice/Services";
import { Works }             from "@/components/whale/in-ice/Works";
import { StudioConnection }  from "@/components/whale/in-ice/StudioConnection";
import { Contact }           from "@/components/whale/in-ice/Contact";
import { Footer }            from "@/components/whale/in-ice/Footer";

export default function WhaleInIcePage() {
  return (
    <>
      <Hero />
      <About />
      <Services />
      <Works />
      <StudioConnection />
      <Contact />
      <Footer />
    </>
  );
}
