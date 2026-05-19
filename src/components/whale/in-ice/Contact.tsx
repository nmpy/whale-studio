// src/components/whale/in-ice/Contact.tsx
//
// 最後の「静かに押せる」CTA (再設計版)。
//   - カード矩形 / 強調背景は廃止
//   - 上に hairline 1 本だけ残し、終わりの余韻を作る
//   - 大きな serif の問いかけ + 短い説明 + HushLink (アンダーライン) のみ
//   - ボタンは使わない

import { Section, Hairline, HushLink } from "./shared";

// TODO: 正式な問い合わせ先 (専用フォーム / Notion 公開リンク / メールアドレス 等) に差し替え。
const CONTACT_HREF = "#contact-todo";

export function Contact() {
  return (
    <Section id="contact" narrow>
      {/* 上端に終わりを示唆する罫線。罫線 1 本だけで「終章」感を出す */}
      <Hairline className="mb-16 md:mb-24" />

      <div className="flex flex-col gap-7 md:gap-9">
        {/* eyebrow — 章番号 + Contact */}
        <div className="flex items-center gap-4 text-[color:var(--ice-accent)]">
          <span className="ice-serif text-[11px] md:text-[12px] tracking-[0.12em] opacity-80">No.05</span>
          <span
            aria-hidden="true"
            className="inline-block h-px flex-1 max-w-[64px]"
            style={{ background: "var(--ice-accent)", opacity: 0.4 }}
          />
          <span className="text-[10px] md:text-[11px] tracking-[0.36em] uppercase">Contact</span>
        </div>

        {/* メインコピー — 大きめ serif、問いかけ調 */}
        <h2 className="ice-serif text-[26px] md:text-[34px] lg:text-[40px] leading-[1.5] font-bold text-[color:var(--ice-text)] max-w-[680px]">
          物語をつくる相談を、<br className="md:hidden" />
          お待ちしています。
        </h2>

        {/* 説明 — 短く */}
        <p className="text-[14px] md:text-[15px] leading-[2.0] text-[color:var(--ice-text-muted)] max-w-[560px]">
          企画段階のラフな構想からでもお話できます。
          脚本 / 演出 / 実装 / 当日運用 ── 必要な工程だけでもお受けします。
        </p>
        <p className="text-[12px] md:text-[13px] leading-[1.95] text-[color:var(--ice-text-faint)] max-w-[560px]">
          公演 / 期間 / 規模 / 予算感の目安を添えていただけるとスムーズです。
        </p>

        {/* CTA — アンダーラインのテキストリンクのみ。ボタンは出さない */}
        <div className="mt-4 md:mt-6">
          <HushLink href={CONTACT_HREF} size="lg">
            → 制作について話す
          </HushLink>
          {/* TODO: 公開時に「✕ への DM も受け付けています」等の具体的導線を追記 */}
        </div>
      </div>
    </Section>
  );
}
