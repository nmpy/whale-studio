// src/app/page.tsx
// ランディングページ (Server Component)。
// 構成:
//   1. Hero        : メインコピー + サブコピー + 個人/法人 2 系統 CTA
//   2. Features    : メッセージ配信 / LIFFページ / QRチェックイン / アンケート・分岐
//   3. Use Cases   : 謎解き / マーダーミステリー / 舞台連動
//   4. Pricing     : 個人 / 法人 / 導入サポート
//   5. End CTA     : Hero と同じ 2 系統 CTA
//
// デザイン:
//   既存トークン (brand / brand-soft / brand-mist / bg-tint / ink / line / rounded-card / font-round)
//   と shared/Button の buttonClass をそのまま使う。Netflix 風には寄せない。
//
// 注: 認証 / Stripe / plan guard / webhook / middleware には一切触らない。
//     LP は Server Component なのでクライアント hooks を持たない。

import Link from "next/link";
import { buttonClass } from "@/components/shared";

const FEATURES = [
  {
    title: "メッセージ配信",
    desc:  "シナリオ進行に合わせた配信を、ノーコードで設計。即時送信・スケジュール・分岐後の追撃まで一括管理できます。",
  },
  {
    title: "LIFFページ",
    desc:  "謎・アンケート・ヒント表示・物販導線などのカスタム LIFF を作品ごとに発行。LINE 内で完結する体験に。",
  },
  {
    title: "QRチェックイン",
    desc:  "公演会場・周遊スポットでの本人確認や進行管理を QR で。来場ログを自動で残し、当日運用を軽くします。",
  },
  {
    title: "アンケート・分岐",
    desc:  "回答内容に応じてシナリオを枝分かれさせ、参加者ごとに異なる結末や追加コンテンツを届けられます。",
  },
];

const USE_CASES = [
  {
    title: "謎解き",
    desc:  "周遊型・1日完結型の謎解きを LINE 上で配信。ヒント送付・正答管理・順位通知まで自動化。",
  },
  {
    title: "マーダーミステリー",
    desc:  "キャラクターごとの個別配信、秘匿情報、投票進行を 1 つの LINE 公式アカウントで運用。",
  },
  {
    title: "舞台連動",
    desc:  "上演前後の告知、観客参加型ギミック、特典配布などを LIFF とメッセージ配信で連動。",
  },
];

export default function LandingPage() {
  return (
    <div className="-mt-7 -mb-12 flex flex-col gap-20 pb-24">
      {/* ── 1. Hero ──────────────────────────────────────────────── */}
      <section className="flex flex-col items-center gap-6 px-5 pt-14 pb-4 text-center sm:pt-20">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-[11px] font-bold tracking-[0.06em] text-brand-ink">
          β版 公開中
        </span>

        <h1 className="font-round text-[clamp(28px,6.5vw,44px)] font-black leading-[1.2] tracking-[0.02em] text-[#1f2a25]">
          LINEで、物語体験をつくる。
        </h1>

        <p className="max-w-[560px] text-[14px] leading-[1.95] text-ink-2 sm:text-[15px]">
          謎解き・マーダーミステリー・舞台連動企画を、ノーコードで構築。
          <br className="hidden sm:block" />
          メッセージ配信、LIFFページ、QRチェックイン、アンケート、分岐導線まで、
          <br className="hidden sm:block" />
          作品ごとの LINE 体験をまとめて管理できます。
        </p>

        <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <Link
            href="/login?intent=individual"
            className={buttonClass({
              variant:   "primary",
              size:      "md",
              className: "!px-8 !py-3 !text-[14px]",
            })}
          >
            個人利用で始める
          </Link>
          <Link
            href="/contact?type=enterprise"
            className={buttonClass({
              variant:   "ghost",
              size:      "md",
              className: "!px-8 !py-3 !text-[14px]",
            })}
          >
            法人の方はこちら
          </Link>
        </div>
      </section>

      {/* ── 2. Features ──────────────────────────────────────────── */}
      <section className="px-5">
        <header className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="text-[11px] font-bold tracking-[0.12em] text-brand-ink uppercase">
            Features
          </span>
          <h2 className="font-round text-[clamp(20px,4.5vw,26px)] font-black text-[#1f2a25]">
            作品ごとの LINE 体験を、一つのスタジオで。
          </h2>
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              className="rounded-card border border-line bg-surface p-6 shadow-card"
            >
              <h3 className="font-round text-[16px] font-bold text-[#1f2a25]">
                {f.title}
              </h3>
              <p className="mt-2 text-[13px] leading-[1.85] text-ink-2">
                {f.desc}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ── 3. Use Cases ─────────────────────────────────────────── */}
      <section className="bg-bg-tint px-5 py-14">
        <header className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="text-[11px] font-bold tracking-[0.12em] text-brand-ink uppercase">
            Use Cases
          </span>
          <h2 className="font-round text-[clamp(20px,4.5vw,26px)] font-black text-[#1f2a25]">
            こんな作品づくりに使われています。
          </h2>
        </header>
        <div className="grid gap-4 sm:grid-cols-3">
          {USE_CASES.map((u) => (
            <article
              key={u.title}
              className="rounded-card border border-line bg-surface p-6"
            >
              <h3 className="font-round text-[15px] font-bold text-brand-ink">
                {u.title}
              </h3>
              <p className="mt-2 text-[13px] leading-[1.85] text-ink-2">
                {u.desc}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ── 4. Pricing ───────────────────────────────────────────── */}
      <section className="px-5">
        <header className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="text-[11px] font-bold tracking-[0.12em] text-brand-ink uppercase">
            Pricing
          </span>
          <h2 className="font-round text-[clamp(20px,4.5vw,26px)] font-black text-[#1f2a25]">
            個人利用から商業公演まで。
          </h2>
          <p className="text-[12.5px] text-ink-3">
            すべて税込・1 LINE 公式アカウント単位。詳細は「プランを見る」から。
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* 個人 */}
          <article className="rounded-card border border-line bg-surface p-6">
            <h3 className="font-round text-[15px] font-bold text-[#1f2a25]">
              個人利用
            </h3>
            <p className="mt-3 font-num text-[26px] font-bold text-brand-ink">
              9,800円
              <span className="ml-1 text-[12px] font-semibold text-ink-3">
                〜 / 月
              </span>
            </p>
            <p className="mt-3 text-[12.5px] leading-[1.85] text-ink-2">
              個人クリエイター向け。小規模公演や同人企画から始められるベーシックなプランです。
            </p>
            <Link
              href="/login?intent=individual"
              className={buttonClass({
                variant:   "primary",
                size:      "md",
                fullWidth: true,
                className: "mt-5",
              })}
            >
              個人利用で始める
            </Link>
          </article>

          {/* 法人 */}
          <article className="rounded-card border-2 border-brand bg-brand-mist p-6">
            <div className="flex items-center justify-between">
              <h3 className="font-round text-[15px] font-bold text-[#1f2a25]">
                法人利用
              </h3>
              <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[10px] font-bold tracking-[0.06em] text-brand-ink">
                おすすめ
              </span>
            </div>
            <p className="mt-3 font-num text-[26px] font-bold text-brand-ink">
              要相談
            </p>
            <p className="mt-3 text-[12.5px] leading-[1.85] text-ink-2">
              商業公演・IP 企画・複数アカウント運用向け。利用規模に合わせて個別にお見積りいたします。
            </p>
            <Link
              href="/contact?type=enterprise"
              className={buttonClass({
                variant:   "primary",
                size:      "md",
                fullWidth: true,
                className: "mt-5",
              })}
            >
              法人の方はこちら
            </Link>
          </article>

          {/* 導入サポート */}
          <article className="rounded-card border border-line bg-surface p-6">
            <h3 className="font-round text-[15px] font-bold text-[#1f2a25]">
              導入サポート
            </h3>
            <p className="mt-3 font-num text-[26px] font-bold text-brand-ink">
              初期 50,000円
              <span className="ml-1 text-[12px] font-semibold text-ink-3">
                〜
              </span>
            </p>
            <p className="mt-3 text-[12.5px] leading-[1.85] text-ink-2">
              作品の LINE 体験設計・初期設定・LIFF 制作までを Whale Studio チームが伴走します。
            </p>
            <Link
              href="/contact?type=onboarding"
              className={buttonClass({
                variant:   "ghost",
                size:      "md",
                fullWidth: true,
                className: "mt-5",
              })}
            >
              相談する
            </Link>
          </article>
        </div>
      </section>

      {/* ── 5. End CTA ───────────────────────────────────────────── */}
      <section className="px-5">
        <div className="mx-auto flex max-w-[560px] flex-col items-center gap-5 rounded-card border border-line bg-brand-soft px-6 py-12 text-center">
          <h2 className="font-round text-[clamp(18px,4vw,22px)] font-black text-[#1f2a25]">
            あなたの作品も、LINEで動かしませんか?
          </h2>
          <p className="text-[13px] leading-[1.85] text-ink-2">
            個人での試験運用も、商業公演での本格運用も、同じ Whale Studio から始められます。
          </p>
          <div className="mt-1 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
            <Link
              href="/login?intent=individual"
              className={buttonClass({
                variant:   "primary",
                size:      "md",
                className: "!px-8 !py-3 !text-[14px]",
              })}
            >
              個人利用で始める
            </Link>
            <Link
              href="/contact?type=enterprise"
              className={buttonClass({
                variant:   "ghost",
                size:      "md",
                className: "!px-8 !py-3 !text-[14px]",
              })}
            >
              法人の方はこちら
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
