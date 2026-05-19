// src/components/whale/in-ice/Hero.tsx

import { CtaLink } from "./shared";

export function Hero() {
  return (
    <section className="relative min-h-[88svh] md:min-h-[92svh] flex items-center px-6 md:px-10 lg:px-12 overflow-hidden">
      {/* 背景の氷感を出すための装飾レイヤー (CSS のみ、画像不要) */}
      <BackgroundOrnaments />

      <div className="relative z-10 mx-auto w-full max-w-[980px]">
        {/* 小さなブランドマーク行 */}
        <div className="ice-fade-up flex items-center gap-2.5 mb-8 md:mb-12">
          <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--ice-accent)]" />
          <p className="text-[11px] md:text-xs tracking-[0.28em] uppercase text-[color:var(--ice-accent)]">
            Whale in Ice
          </p>
        </div>

        {/* メインコピー */}
        <h1
          className="ice-fade-up ice-serif text-[36px] md:text-[58px] lg:text-[72px] leading-[1.2] font-bold text-[color:var(--ice-text)] mb-6 md:mb-8"
          style={{ animationDelay: "0.1s" }}
        >
          思い出ではなく、<br className="md:hidden" />
          残像を。
        </h1>

        {/* サブコピー / 日本語タイトル */}
        <p
          className="ice-fade-up text-[15px] md:text-[17px] leading-[2.0] text-[color:var(--ice-text-muted)] mb-3 max-w-[600px]"
          style={{ animationDelay: "0.25s" }}
        >
          氷のくじらは、物語のあとに残る体験を設計する制作レーベル。<br />
          謎解き / マーダーミステリー / イマーシブ / LINE 連動。
        </p>
        <p
          className="ice-fade-up text-[12px] md:text-[13px] tracking-[0.18em] text-[color:var(--ice-text-faint)] mb-12 md:mb-16"
          style={{ animationDelay: "0.35s" }}
        >
          一度見ただけでは終わらない、体験の余韻を。
        </p>

        {/* CTA */}
        <div
          className="ice-fade-up flex flex-wrap items-center gap-3 md:gap-4"
          style={{ animationDelay: "0.5s" }}
        >
          <CtaLink href="#contact">制作について相談する</CtaLink>
          <CtaLink href="#about" variant="ghost">レーベルについて</CtaLink>
        </div>
      </div>

      {/* スクロール示唆 (PC のみ、控えめ) */}
      <div className="hidden md:flex absolute bottom-10 left-1/2 -translate-x-1/2 items-center gap-2 text-[10px] tracking-[0.3em] uppercase text-[color:var(--ice-text-faint)]">
        <span className="w-px h-10 bg-gradient-to-b from-transparent to-[color:var(--ice-text-faint)]" aria-hidden="true" />
        Scroll
      </div>
    </section>
  );
}

// ── 背景: 氷の結晶っぽいぼんやりした光、CSS のみで生成 ─────────────────────
function BackgroundOrnaments() {
  return (
    <>
      {/* 上空のぼやけた光 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[120%] h-[60vh] opacity-60"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(157, 200, 224, 0.22) 0%, rgba(15, 33, 56, 0) 60%)",
          filter: "blur(40px)",
        }}
      />
      {/* 微細な縦線で氷柱を暗示する装飾 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, rgba(199, 226, 242, 0.6) 0px, rgba(199, 226, 242, 0) 1px, rgba(199, 226, 242, 0) 6px)",
        }}
      />
    </>
  );
}
