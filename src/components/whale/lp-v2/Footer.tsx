// src/components/whale/lp-v2/Footer.tsx
//
// リンク先はすべて既存ルート (/terms, /privacy, /pricing, /login)。
// 新規ページは作らない。

import { WhaleMark } from "./WhaleMark";
import { LOGIN_HREF, PRICING_HREF, REGISTER_HREF } from "./shared";

const LINKS: Array<{ href: string; label: string }> = [
  { href: PRICING_HREF, label: "料金" },
  { href: REGISTER_HREF, label: "新規登録" },
  { href: LOGIN_HREF, label: "ログイン" },
  { href: "/terms", label: "利用規約" },
  { href: "/privacy", label: "プライバシーポリシー" },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="px-6 md:px-10 lg:px-12 py-12 md:py-16 border-t border-[color:var(--ws-border)]">
      <div className="mx-auto w-full max-w-[1080px] flex flex-col md:flex-row md:items-start md:justify-between gap-8">
        <div>
          <div className="flex items-center gap-2.5 mb-2.5">
            <WhaleMark className="w-7 h-7 text-[color:var(--ws-navy)]" title="Whale Studio" />
            <span className="text-[15px] md:text-[16px] font-bold text-[color:var(--ws-text)]">
              Whale Studio
            </span>
          </div>
          <p className="text-[12px] leading-[1.9] text-[color:var(--ws-text-faint)]">
            LINEで物語体験をつくるスタジオ
          </p>
        </div>

        <nav aria-label="フッター">
          <ul className="flex flex-wrap gap-x-6 gap-y-3">
            {LINKS.map((l) => (
              <li key={l.label}>
                <a
                  href={l.href}
                  className="text-[12.5px] text-[color:var(--ws-text-muted)] hover:text-[color:var(--ws-navy)] transition-colors duration-200"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="mx-auto w-full max-w-[1080px] mt-10 pt-6 border-t border-[color:var(--ws-border)] text-[11px] tracking-[0.06em] text-[color:var(--ws-text-faint)]">
        © {year} Whale Studio.
      </div>
    </footer>
  );
}
