// src/components/whale/lp-v2/Hero.tsx

import { CtaLink, REGISTER_HREF, LOGIN_HREF, Badge } from "./shared";
import { WhaleMark } from "./WhaleMark";

export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 md:px-10 lg:px-12 pt-20 md:pt-28 lg:pt-32 pb-20 md:pb-24">
      <BackgroundOrnaments />

      <div className="relative z-10 mx-auto w-full max-w-[1080px]">
        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-12 lg:gap-10 items-center">
          {/* ── コピー ─────────────────────────────────────────── */}
          <div>
            <div className="ws-fade-up mb-6">
              <Badge tone="line">LINE 公式アカウント / LIFF 連動</Badge>
            </div>

            <h1
              className="ws-fade-up text-[32px] md:text-[46px] lg:text-[54px] leading-[1.28] font-bold text-[color:var(--ws-text)] mb-6"
              style={{ animationDelay: "0.08s" }}
            >
              LINEで、
              <br className="hidden md:block" />
              物語体験をつくる。
            </h1>

            <p
              className="ws-fade-up text-[15px] md:text-[17px] leading-[2.0] text-[color:var(--ws-text-muted)] mb-8 max-w-[560px]"
              style={{ animationDelay: "0.18s" }}
            >
              Whale Studio は、LINE 公式アカウントと LIFF を使った物語体験を
              <strong className="font-semibold text-[color:var(--ws-text)]">
                企画から当日運用まで一気通貫
              </strong>
              で構築・運用する SaaS です。
              <br />
              シナリオ設計、キャラクター、謎、現地チェックイン、参加者分析までを 1 つの管理画面に。
            </p>

            <div
              className="ws-fade-up flex flex-wrap items-center gap-3 md:gap-4 mb-6"
              style={{ animationDelay: "0.3s" }}
            >
              <CtaLink href={REGISTER_HREF}>無料で登録する</CtaLink>
              <CtaLink href={LOGIN_HREF} variant="ghost">
                ログイン
              </CtaLink>
            </div>

            <p
              className="ws-fade-up text-[12px] md:text-[13px] leading-[1.9] text-[color:var(--ws-text-faint)]"
              style={{ animationDelay: "0.4s" }}
            >
              制作会社・劇団・イベント主催者の方へ公開しています。
              法人でのご利用・委託制作のご相談も承ります。
            </p>
          </div>

          {/* ── ブランドシンボル ────────────────────────────────
              画像ファイルではなく自前 SVG。数字や実績を捏造せず、
              ブランド表現だけでヒーローを成立させる。 */}
          <div
            className="ws-fade-up hidden lg:flex justify-center items-center"
            style={{ animationDelay: "0.25s" }}
          >
            <WhaleMark className="w-[380px] h-[380px] text-[color:var(--ws-navy)] opacity-[0.92]" />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── 背景装飾: CSS グラデーションのみ (画像不要) ─────────────────────────
function BackgroundOrnaments() {
  return (
    <>
      {/* 上方のやわらかいブランド光 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[130%] h-[70vh]"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(34, 38, 100, 0.10) 0%, rgba(34, 38, 100, 0) 62%)",
          filter: "blur(30px)",
        }}
      />
      {/* 下端: 次セクションへのなじませ */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32"
        style={{
          background:
            "linear-gradient(180deg, rgba(246, 247, 251, 0) 0%, var(--ws-bg-tint) 100%)",
        }}
      />
    </>
  );
}
