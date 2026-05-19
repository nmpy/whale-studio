// src/components/whale/in-ice/Contact.tsx
//
// LP の最終ブロック。強い横長 CTA カード。
// セクション背景は出さない (= 全体 #06111F)。
// 強調カード (--ice-surface-soft) を 1 枚だけ大きく置き、
// 左: 大型コピー + サブ / 右: 大型 primary CTA を配置。SP では縦積み。

import { Section, CtaLink } from "./shared";

// TODO: 正式な問い合わせ先 (専用フォーム / Notion 公開リンク / メールアドレス 等) に差し替え。
//       現状は仮アンカー。アドレスが定まっていないので "#contact-todo" を当てておく。
const CONTACT_HREF = "#contact-todo";

export function Contact() {
  return (
    <Section id="contact">
      <div
        className="rounded-[28px] border p-8 md:p-12 lg:p-14 flex flex-col md:flex-row md:items-end md:justify-between gap-8 md:gap-10"
        style={{
          background: "var(--ice-surface-soft)",
          borderColor: "var(--ice-border-strong)",
        }}
      >
        {/* 左: コピー */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-5">
            <span
              aria-hidden="true"
              className="inline-block w-7 h-px"
              style={{ background: "var(--ice-accent)", opacity: 0.7 }}
            />
            <span className="text-[10px] md:text-[11px] tracking-[0.32em] uppercase text-[color:var(--ice-accent)]">
              Contact
            </span>
          </div>

          <h2 className="ice-serif text-[26px] md:text-[32px] lg:text-[38px] leading-[1.35] font-bold text-[color:var(--ice-text)] mb-5 max-w-[680px]">
            体験企画の相談を、<br className="md:hidden" />
            受け付けています。
          </h2>
          <p className="text-[13px] md:text-[14px] leading-[2.0] text-[color:var(--ice-text-muted)] max-w-[560px] mb-3">
            企画段階のラフな構想からでもお話できます。<br className="hidden md:inline" />
            脚本 / 演出 / 実装 / 当日運用 — 必要な工程だけのご依頼でもお受けします。
          </p>
          <p className="text-[12px] md:text-[13px] leading-[1.9] text-[color:var(--ice-text-faint)]">
            公演 / 期間 / 規模 / 予算感の目安を添えていただけるとスムーズです。
          </p>
        </div>

        {/* 右: 大型 primary CTA */}
        <div className="shrink-0">
          <CtaLink href={CONTACT_HREF}>制作について相談する</CtaLink>
          {/* TODO: 公開時に「✕ への DM も受け付けています」等の具体的導線を追記 */}
        </div>
      </div>
    </Section>
  );
}
