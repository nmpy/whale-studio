// src/components/whale/in-ice/Header.tsx
//
// 大幅軽量化版 (UI 再設計):
//   - sticky / backdrop-blur / 5 ナビ ピル を全廃
//   - 通常配置 (= スクロールで普通に流れる)
//   - 左: ロゴ「氷のくじら / Whale in Ice」
//   - 右: 小さな「Contact ↗」アンダーラインテキストリンクのみ
//   - 背景なし、罫線なし、高さも控えめ
//   - SaaS LP の汎用ヘッダー感を排除し、作品レーベル感を出す

export function Header() {
  return (
    <header className="px-6 md:px-10 lg:px-12 pt-8 md:pt-10">
      <div className="mx-auto w-full max-w-[1100px] flex items-center justify-between gap-4">
        {/* ロゴ — 控えめサイズ */}
        <a
          href="#top"
          aria-label="氷のくじら — Whale in Ice"
          className="flex items-center gap-2.5 group"
        >
          <span
            aria-hidden="true"
            className="inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--ice-accent)] transition-opacity duration-200 group-hover:opacity-80"
          />
          <span className="flex items-center gap-2.5">
            <span className="ice-serif text-[13px] md:text-[14px] tracking-[0.06em] text-[color:var(--ice-text)]">
              氷のくじら
            </span>
            <span aria-hidden="true" className="opacity-40 text-[10px] text-[color:var(--ice-text-faint)]">
              /
            </span>
            <span className="text-[10px] md:text-[11px] tracking-[0.24em] uppercase text-[color:var(--ice-text-faint)]">
              Whale in Ice
            </span>
          </span>
        </a>

        {/* 右: Contact text link のみ。ボタン / ピル / 背景なし */}
        <a
          href="#contact"
          className="text-[11px] md:text-[12px] tracking-[0.18em] uppercase text-[color:var(--ice-text-muted)] hover:text-[color:var(--ice-accent)] transition-colors duration-200 underline underline-offset-[6px] decoration-[color:var(--ice-border-strong)] hover:decoration-[color:var(--ice-accent)]"
        >
          Contact
        </a>
      </div>
    </header>
  );
}
