// src/components/whale/in-ice/Hero.tsx
//
// Hero セクション。世界観を一発で伝える要。
//   - 「思い出ではなく、残像を。」を主役コピーとして維持
//   - Whale in Ice / 氷のくじら を併記して初見でも日本語ブランドが分かる
//   - PC で見出しが大きすぎないよう上限 54px、コンテンツ box max-w-[860px]
//   - 上空のぼやけた光と微細な縦線で氷の世界観を CSS のみで表現
//   - Header (60-68px) のすぐ下に来るので min-h は svh ベースで控えめに

import { CtaLink } from "./shared";

export function Hero() {
  return (
    <section className="relative min-h-[78svh] md:min-h-[84svh] flex items-center px-6 md:px-10 lg:px-12 overflow-hidden">
      {/* 背景の氷感を出すための装飾レイヤー (CSS のみ、画像不要) */}
      <BackgroundOrnaments />

      <div className="relative z-10 mx-auto w-full max-w-[860px] py-12 md:py-16">
        {/* 小さなブランドマーク行 — Whale in Ice / 氷のくじら を併記 */}
        <div className="ice-fade-up flex items-center gap-2.5 mb-8 md:mb-12 text-[color:var(--ice-accent)]">
          <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--ice-accent)]" />
          <p className="flex items-center gap-2.5 md:gap-3">
            <span className="text-[11px] md:text-xs tracking-[0.28em] uppercase">Whale in Ice</span>
            <span aria-hidden="true" className="opacity-40 text-xs">/</span>
            <span className="ice-serif text-[12px] md:text-[13px] tracking-[0.08em]">氷のくじら</span>
          </p>
        </div>

        {/* メインコピー — PC で大きすぎないよう上限 54px、行長は max-w-[720px] で制御 */}
        <h1
          className="ice-fade-up ice-serif text-[34px] md:text-[46px] lg:text-[54px] leading-[1.25] font-bold text-[color:var(--ice-text)] mb-6 md:mb-8 max-w-[720px]"
          style={{ animationDelay: "0.1s" }}
        >
          思い出ではなく、<br className="md:hidden" />
          残像を。
        </h1>

        {/* サブコピー — 制作レーベルとしての要約 */}
        <p
          className="ice-fade-up text-[15px] md:text-[17px] leading-[2.0] text-[color:var(--ice-text-muted)] mb-3 max-w-[600px]"
          style={{ animationDelay: "0.25s" }}
        >
          氷のくじらは、物語のあとに残る体験を設計する制作レーベル。<br />
          謎解き / マーダーミステリー / イマーシブ / LINE 連動。
        </p>
        <p
          className="ice-fade-up text-[12px] md:text-[13px] tracking-[0.18em] text-[color:var(--ice-text-faint)] mb-10 md:mb-14"
          style={{ animationDelay: "0.35s" }}
        >
          一度見ただけでは終わらない、体験の余韻を。
        </p>

        {/* CTA — primary を最優先、ghost は補助 */}
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

// ── 背景: 氷っぽい光のグラデーション + 微細な縦線。CSS のみで生成 ─────────────
function BackgroundOrnaments() {
  return (
    <>
      {/* 上空のぼやけた光 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[120%] h-[70vh] opacity-70"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(189, 232, 255, 0.16) 0%, rgba(6, 17, 31, 0) 65%)",
          filter: "blur(48px)",
        }}
      />
      {/* 微細な縦線で氷柱を暗示 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, rgba(189, 232, 255, 0.6) 0px, rgba(189, 232, 255, 0) 1px, rgba(189, 232, 255, 0) 7px)",
        }}
      />
    </>
  );
}
