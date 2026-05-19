// src/components/whale/in-ice/Footer.tsx
//
// 一行のフッター (再設計版)。
//   - 装飾なし、罫線なし
//   - ブランド名 + 短い詩文 + Copyright のみ
//   - フォントを少しだけ落ち着かせる (色を text-faint に統一)

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="px-6 md:px-10 lg:px-12 pt-10 pb-16 md:pb-20">
      <div className="mx-auto w-full max-w-[1100px] flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div>
          <p className="ice-serif text-[13px] md:text-[14px] text-[color:var(--ice-text-muted)] mb-1.5">
            氷のくじら ─ Whale in Ice
          </p>
          <p className="text-[11px] md:text-[12px] leading-[1.8] tracking-[0.04em] text-[color:var(--ice-text-faint)]">
            物語のあとに残る、名前のない感触を。
          </p>
        </div>
        <div className="text-[10px] md:text-[11px] tracking-[0.12em] uppercase text-[color:var(--ice-text-faint)]">
          © {year} Whale in Ice
        </div>
      </div>
    </footer>
  );
}
