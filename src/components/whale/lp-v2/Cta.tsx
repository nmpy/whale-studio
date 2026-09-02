// src/components/whale/lp-v2/Cta.tsx
//
// 最終 CTA。登録導線は既存の login ルート契約 (?mode=register) に合わせるだけで、
// 認証処理そのものには一切手を入れない。

import { CtaLink, REGISTER_HREF, PRICING_HREF } from "./shared";
import { WhaleMark } from "./WhaleMark";

export function Cta() {
  return (
    <section className="relative overflow-hidden px-6 md:px-10 lg:px-12 py-20 md:py-24 bg-[color:var(--ws-navy)] text-white">
      {/* 背景のくじら (装飾)。白の低不透明度で沈める。 */}
      <WhaleMark
        className="pointer-events-none absolute -right-16 -bottom-24 w-[420px] h-[420px] text-white opacity-[0.07] hidden md:block"
      />

      <div className="relative z-10 mx-auto w-full max-w-[1080px]">
        <p className="text-[11px] md:text-xs tracking-[0.24em] uppercase text-white/60 mb-4">
          Get started
        </p>
        <h2 className="text-[26px] md:text-[36px] leading-[1.35] font-bold mb-5 max-w-[680px]">
          つくりたい物語から、
          <br className="hidden md:block" />
          はじめてみませんか。
        </h2>
        <p className="text-[14px] md:text-[15px] leading-[2.0] text-white/75 mb-9 max-w-[600px]">
          まずはアカウントを登録して、管理画面をご覧ください。
          LINE 公式アカウントの接続や作品づくりは、登録後にご案内します。
        </p>

        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          {/* primary は白抜きにする (ネイビー面の上ではブランド塗りが沈むため) */}
          <a
            href={REGISTER_HREF}
            className="inline-flex items-center gap-2 text-[14px] md:text-[15px] font-semibold px-6 md:px-7 py-3.5 rounded-full bg-white text-[color:var(--ws-navy)] hover:bg-white/90 transition-colors duration-200"
          >
            無料で登録する
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="13 6 19 12 13 18" />
            </svg>
          </a>
          <a
            href={PRICING_HREF}
            className="inline-flex items-center gap-2 text-[14px] md:text-[15px] font-semibold px-6 md:px-7 py-3.5 rounded-full border border-white/35 text-white hover:bg-white/10 transition-colors duration-200"
          >
            料金を見る
          </a>
        </div>
      </div>
    </section>
  );
}
