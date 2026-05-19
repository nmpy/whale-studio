// src/components/whale/in-ice/Hero.tsx
//
// フルスクリーン Hero (再設計版)。
//   - 1 画面 = Hero のみ。他要素を混ぜず詩のように見せる
//   - 見出しは大きめ serif: PC 80px / SP 40px。「思い出ではなく、残像を。」を主役
//   - CTA ボタンは廃止 (Header 右上と Contact 末尾だけで十分)
//   - ブランド名「Whale in Ice / 氷のくじら」は画面下端 (右) にひっそり
//   - 「Scroll」示唆を画面下中央に控えめに
//   - 背景は layout の aurora に任せ、Hero 内の装飾は微弱に絞る

export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center px-6 md:px-10 lg:px-12 overflow-hidden">
      {/* 中央コンテンツ — 左寄せ、コンテンツ幅は中庸 */}
      <div className="relative z-10 mx-auto w-full max-w-[980px] py-20 md:py-24">
        {/* メインコピー — 大型 serif、複数行で詩的に */}
        <h1
          className="ice-fade-up ice-serif text-[40px] md:text-[64px] lg:text-[80px] leading-[1.3] font-bold text-[color:var(--ice-text)] max-w-[820px]"
          style={{ animationDelay: "0.1s" }}
        >
          思い出ではなく、<br />
          残像を。
        </h1>

        {/* リード — 大きめ serif イタリック、短く */}
        <p
          className="ice-fade-up ice-serif italic text-[16px] md:text-[20px] lg:text-[22px] leading-[1.95] text-[color:var(--ice-text-muted)] mt-10 md:mt-14 max-w-[640px]"
          style={{ animationDelay: "0.3s" }}
        >
          物語のあとに残る体験を、設計する。
        </p>

        {/* 副文 — 何を扱うか、ごく短く */}
        <p
          className="ice-fade-up text-[12px] md:text-[13px] tracking-[0.16em] text-[color:var(--ice-text-faint)] mt-6 md:mt-8 max-w-[640px]"
          style={{ animationDelay: "0.45s" }}
        >
          謎解き / マーダーミステリー / イマーシブ / LINE 連動。
        </p>
      </div>

      {/* 左下のブランド名 — ひっそり。Header と被らないよう Hero 内の下端に置く */}
      <div
        className="ice-fade-up absolute left-6 md:left-10 lg:left-12 bottom-8 md:bottom-10 flex items-center gap-2.5 text-[color:var(--ice-text-faint)]"
        style={{ animationDelay: "0.6s" }}
      >
        <span aria-hidden="true" className="inline-block w-1 h-1 rounded-full bg-[color:var(--ice-accent)] opacity-70" />
        <span className="text-[10px] md:text-[11px] tracking-[0.28em] uppercase">Whale in Ice</span>
        <span aria-hidden="true" className="opacity-40">/</span>
        <span className="ice-serif text-[11px] md:text-[12px] tracking-[0.08em]">氷のくじら</span>
      </div>

      {/* Scroll 示唆 — PC のみ、ごく控えめ */}
      <div
        className="ice-fade-up hidden md:flex absolute right-10 lg:right-12 bottom-10 items-center gap-2 text-[10px] tracking-[0.32em] uppercase text-[color:var(--ice-text-faint)]"
        style={{ animationDelay: "0.75s" }}
      >
        Scroll
        <span className="w-px h-10 bg-gradient-to-b from-[color:var(--ice-text-faint)] to-transparent" aria-hidden="true" />
      </div>
    </section>
  );
}
