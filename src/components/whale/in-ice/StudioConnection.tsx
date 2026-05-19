// src/components/whale/in-ice/StudioConnection.tsx
//
// Whale Studio を「制作の舞台裏」として、ほぼ脚注のように紹介する (再設計版)。
//   - 2 column / 補足カード / CTA ボックスは全廃
//   - 短い 1 段落の本文 + 末尾に HushLink (アンダーラインテキスト) のみ
//   - 視覚的優先度を Section の中でもっとも低く保つ

import { Section, SectionHeading, HushLink } from "./shared";

export function StudioConnection() {
  return (
    <Section id="studio" narrow>
      <SectionHeading
        number="No.04"
        eyebrow="Behind the Scenes"
        title="物語を運用するための、技術基盤。"
      />

      <div className="flex flex-col gap-7 md:gap-9">
        <p className="text-[15px] md:text-[16px] leading-[2.1] text-[color:var(--ice-text-muted)]">
          氷のくじらの制作は、自社で開発している体験運用プラットフォーム
          <span className="ice-serif px-1 text-[color:var(--ice-text)]">Whale Studio</span>
          に支えられています。LINE 公式アカウントと LIFF を使った物語体験を、企画から運用まで通すための舞台裏です。
        </p>
        <p className="text-[14px] md:text-[15px] leading-[2.0] text-[color:var(--ice-text-faint)]">
          観客 1 人ひとりに固有の物語、現地でのチェックイン、QR からの分岐、GM フロー、当日対応。
          運用負荷を下げ、現場が物語に集中できる状態を作るための技術として動いています。
        </p>

        <div className="mt-3 md:mt-4">
          <HushLink href="/" external size="md">
            Whale Studio について
          </HushLink>
        </div>
      </div>
    </Section>
  );
}
