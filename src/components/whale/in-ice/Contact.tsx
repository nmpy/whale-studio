// src/components/whale/in-ice/Contact.tsx
//
// 制作相談の導線。フォームは持たず、CTA + 案内テキストのみ。
// 正式な問い合わせ URL が決まったら CTA の href を差し替える。

import { Section, SectionHeading, CtaLink } from "./shared";

// TODO: 正式な問い合わせ先 (専用フォーム / Notion 公開リンク / メールアドレス 等) に差し替え。
//       現状は仮の mailto:。アドレスが定まっていないので "#contact-todo" を当てておく。
const CONTACT_HREF = "#contact-todo";

export function Contact() {
  return (
    <Section id="contact" className="bg-[color:var(--ice-deep)]/40">
      <SectionHeading
        eyebrow="Contact"
        title="制作について相談する"
        subtitle="企画段階のラフな構想からでもお話できます。公演 / 期間 / 規模 / 予算感の目安を添えていただけるとスムーズです。"
      />

      <div className="rounded-2xl border border-[color:var(--ice-border-strong)] bg-[color:var(--ice-surface)]/70 p-8 md:p-10 lg:p-12 flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
          <div>
            <p className="ice-serif text-[20px] md:text-[24px] leading-snug text-[color:var(--ice-text)] mb-3">
              体験企画のご相談を受け付けています。
            </p>
            <p className="text-[13px] md:text-[14px] leading-[1.9] text-[color:var(--ice-text-muted)]">
              脚本 / 演出 / 実装 / 当日運用 — 必要な工程だけのご依頼でもお受けします。
            </p>
          </div>
          <div className="shrink-0">
            <CtaLink href={CONTACT_HREF}>制作について相談する</CtaLink>
          </div>
        </div>

        <p className="text-[11px] md:text-[12px] leading-[1.9] text-[color:var(--ice-text-faint)] border-t border-[color:var(--ice-border)] pt-5">
          ※ 内容によってはお時間をいただく場合があります。返信は平日中心です。
          {/* TODO: 公開時に「✕ への DM も受け付けています」等の具体的導線を追記 */}
        </p>
      </div>
    </Section>
  );
}
