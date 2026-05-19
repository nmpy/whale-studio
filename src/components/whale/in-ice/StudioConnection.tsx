// src/components/whale/in-ice/StudioConnection.tsx
//
// Whale Studio (SaaS) を「制作を支える技術基盤」として控えめに紹介するセクション。
// 主役はあくまで氷のくじら。SaaS LP に寄せない。
// UI polish 版: セクション背景なし、視覚的優先度を下げて補足扱いに。

import { Section, SectionHeading, CtaLink } from "./shared";

export function StudioConnection() {
  return (
    <Section id="studio">
      <SectionHeading
        eyebrow="Behind the Scenes"
        title={
          <>
            物語を運用するための<br className="md:hidden" />
            技術基盤。
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12 items-start">
        <div className="md:col-span-7">
          <p className="text-[14px] md:text-[15px] leading-[2.0] text-[color:var(--ice-text-muted)]">
            氷のくじらの制作は、自社で開発している体験運用プラットフォーム
            <span className="ice-serif px-1 text-[color:var(--ice-text)]">Whale Studio</span>
            に支えられています。
          </p>
          <p className="text-[13px] md:text-[14px] leading-[1.95] text-[color:var(--ice-text-faint)] mt-4">
            LINE 公式アカウントと LIFF を使った物語体験を、企画から運用まで一気通貫で構築・運用する基盤です。
            観客 1 人ひとりに固有の物語、現地でのチェックイン、QR からの分岐、GM フロー、当日対応。
            運用負荷を下げ、当日の現場に集中するための舞台裏として動いています。
          </p>
        </div>

        {/* 右カラム: 控えめな補足カード + ghost CTA */}
        <aside className="md:col-span-5">
          <div
            className="rounded-2xl border p-6 md:p-7"
            style={{
              background: "var(--ice-surface)",
              borderColor: "var(--ice-border)",
            }}
          >
            <p className="text-[10px] md:text-[11px] tracking-[0.24em] uppercase text-[color:var(--ice-accent)] mb-3">
              Platform
            </p>
            <p className="ice-serif text-[15px] md:text-[16px] text-[color:var(--ice-text)] mb-2">
              Whale Studio
            </p>
            <p className="text-[12px] md:text-[13px] leading-[1.9] text-[color:var(--ice-text-faint)] mb-5">
              LINE で物語体験をつくる運用基盤。<br />
              制作会社・劇団・イベント主催者向けに公開しています。
            </p>
            <CtaLink href="/" variant="ghost">
              Whale Studio を見る
            </CtaLink>
          </div>
        </aside>
      </div>
    </Section>
  );
}
