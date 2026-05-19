// src/components/whale/in-ice/Footer.tsx
//
// 控えめなフッター。塗りつぶし背景なし、薄い罫線のみ。

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer
      className="px-6 md:px-10 lg:px-12 py-12 md:py-16 border-t"
      style={{ borderColor: "var(--ice-border)" }}
    >
      <div className="mx-auto w-full max-w-[1100px] flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          <p className="ice-serif text-[14px] md:text-[15px] text-[color:var(--ice-text)] mb-1">
            氷のくじら — Whale in Ice
          </p>
          <p className="text-[11px] md:text-[12px] tracking-[0.06em] text-[color:var(--ice-text-faint)]">
            物語のあとに残る、名前のない感触を。
          </p>
        </div>
        <div className="text-[10px] md:text-[11px] tracking-[0.08em] text-[color:var(--ice-text-faint)]">
          © {year} Whale in Ice. Powered by Whale Studio.
        </div>
      </div>
    </footer>
  );
}
