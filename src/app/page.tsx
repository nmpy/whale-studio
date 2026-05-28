// src/app/page.tsx
// 公開ランディングページ（Server Component）。
// 個人クリエイター向けに「何のサービスか」「どう始めるか」を提示する集客LP。
//
// - 認証状態は getServerUser で取得し、右上CTAを出し分ける。
// - メール入力 / FAQ のみ client component（LandingEmailForm / LandingFaq）。
// - AppShell 側で "/" は bare layout（AppHeader / container なし）に設定済み。
// - トーン: 既存 Studio.site 風の明るい / 余白広め / ミニマル / 透明感。

import type { Metadata } from "next";
import Link from "next/link";
import { getServerUser } from "@/lib/supabase/server";
import { isPlatformOwner } from "@/lib/platform-admin";
import { isAnyWorkspaceOwner } from "@/lib/rbac";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingMockCards } from "@/components/landing/LandingMockCards";
import { LandingEmailForm } from "@/components/landing/LandingEmailForm";
import { LandingFaq } from "@/components/landing/LandingFaq";

// 認証状態（getServerUser）で右上CTAを出し分けるため、毎リクエストでレンダリングする。
// LP 本文・metadata はログイン状態に依存しないため SEO への影響はない。
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Whale Studio | LINEでつくる物語体験",
  description:
    "Whale Studioは、LINE上で謎解き・マーダーミステリー・周遊イベントなどの物語体験を制作・運用できるツールです。",
  openGraph: {
    title: "Whale Studio | LINEでつくる物語体験",
    description:
      "Whale Studioは、LINE上で謎解き・マーダーミステリー・周遊イベントなどの物語体験を制作・運用できるツールです。",
    siteName: "Whale Studio",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Whale Studio | LINEでつくる物語体験",
    description: "Whale Studioは、LINE上で物語体験を制作・運用できるツールです。",
  },
  robots: { index: true, follow: true },
};

const USE_CASES = [
  { title: "マダミス制作", desc: "シナリオ・配役・進行をLINEで運用" },
  { title: "謎解き・ARG", desc: "分岐と正誤判定で没入感のある謎を" },
  { title: "舞台連動", desc: "事前登録から終演後アンケートまで" },
  { title: "周遊イベント", desc: "QR / GPSチェックインで街を巡る" },
  { title: "LINE公式アカウント運用", desc: "メッセージ配信と導線をまとめて" },
];

const FEATURES = [
  { n: 1, title: "LINEメッセージを自動で分岐", desc: "キーワードや進行状況に応じて返信を切り替え。" },
  { n: 2, title: "LIFFページをノーコードで作成", desc: "参加者向けの画面を管理画面から構築。" },
  { n: 3, title: "QR / GPSチェックインを管理", desc: "現地到達を記録し、周遊や来場を可視化。" },
  { n: 4, title: "アンケート結果を確認", desc: "自由入力や回答を集約してふりかえり。" },
  { n: 5, title: "作品ごとに導線を整理", desc: "メッセージ・フェーズ・分岐を一元管理。" },
  { n: 6, title: "公演後のシェア導線を設計", desc: "終演後の感想・拡散までを設計できる。" },
];

const REASONS = [
  { title: "LINEだけで体験が完結", desc: "参加者はアプリを増やさず、いつものLINEから物語に入れます。" },
  { title: "物語体験に必要な機能を集約", desc: "メッセージ、LIFF、チェックイン、アンケート、分岐をひとつの管理画面で扱えます。" },
  { title: "個人制作でも始めやすい", desc: "小規模な作品やβテストから始め、商業公演やイベント運用へ拡張できます。" },
  { title: "舞台・周遊企画にも対応", desc: "事前登録、当日QR、設定資料の閲覧、終演後アンケートまで一連の導線を設計できます。" },
];

export default async function LandingPage() {
  const user = await getServerUser();
  const isLoggedIn = !!user;
  let canAccessAdmin = false;
  if (user) {
    canAccessAdmin = isPlatformOwner(user.id) || (await isAnyWorkspaceOwner(user.id));
  }

  return (
    <div className="min-h-screen bg-white text-[#1F2A24]">
      <LandingHeader isLoggedIn={isLoggedIn} canAccessAdmin={canAccessAdmin} />

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#F8FAF8]">
        <LandingMockCards />
        <div className="relative mx-auto flex max-w-[760px] flex-col items-center gap-6 px-5 py-28 text-center sm:py-36">
          {/* β版 pill */}
          <span className="inline-flex items-center rounded-full bg-[#E6F7EE] px-3.5 py-1 text-[11px] font-bold tracking-[0.06em] text-[#0a8f43]">
            β版
          </span>

          {/* H1: WHALE STUDIO（letter-spacing 広め）*/}
          <h1 className="font-round text-[clamp(34px,8vw,60px)] font-black leading-none tracking-[0.16em] text-[#1F2A24]">
            WHALE STUDIO
          </h1>

          {/* サブ見出し */}
          <p className="font-round text-[clamp(15px,3.5vw,18px)] font-bold tracking-[0.04em] text-[#3a463f]">
            LINEでつくる物語体験
          </p>

          {/* 説明文 */}
          <p className="max-w-[560px] text-[14px] leading-[2] text-[#5F6B64] sm:text-[15px]">
            マーダーミステリー、謎解き、周遊企画など。
            <br className="hidden sm:block" />
            メッセージ・LIFF・チェックイン・分岐をまとめて管理。
            <br />
            <span className="text-[#8a948d]">小規模な個人制作から商用公演・イベント運用まで。</span>
          </p>

          {/* CTA */}
          <div className="mt-3 flex w-full flex-col items-center gap-4">
            <LandingEmailForm source="hero" />
            <Link href="/pricing" className="text-[13px] font-medium text-[#5F6B64] underline-offset-4 transition hover:text-[#06C755] hover:underline">
              プランを見る
            </Link>
          </div>
        </div>
      </section>

      {/* ── 利用シーン ─────────────────────────────────────────── */}
      <section className="bg-white">
        <div className="mx-auto max-w-[1100px] px-5 py-20">
          <h2 className="mb-10 text-center text-[clamp(19px,4vw,26px)] font-bold text-[#1F2A24]">
            個人制作から、商業公演・イベント運用まで。
          </h2>
          <div className="flex flex-wrap justify-center gap-3">
            {USE_CASES.map((u) => (
              <div
                key={u.title}
                className="rounded-2xl border border-[#E3EAE4] bg-white px-5 py-4 text-center shadow-[0_1px_3px_rgba(31,42,36,0.04)] transition hover:-translate-y-0.5 hover:border-[#06C755]/40"
              >
                <div className="text-[14px] font-bold text-[#06C755]">{u.title}</div>
                <div className="mt-1 text-[12px] leading-[1.7] text-[#5F6B64]">{u.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── できること（横スクロール / ミニマル）──────────────────── */}
      <section id="features" className="bg-[#F7FAF7]">
        <div className="mx-auto max-w-[1100px] px-5 py-20">
          <h2 className="mb-10 text-center text-[clamp(19px,4vw,26px)] font-bold text-[#1F2A24]">
            Whale Studioでできること
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-4 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.n}
                className="min-w-[240px] rounded-2xl border border-[#E3EAE4] bg-white p-6 shadow-[0_1px_3px_rgba(31,42,36,0.04)] transition hover:-translate-y-0.5 sm:min-w-0"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E6F7EE] text-[12px] font-bold text-[#06C755]">
                  {f.n}
                </span>
                <div className="mt-4 text-[15px] font-bold text-[#1F2A24]">{f.title}</div>
                <div className="mt-2 text-[13px] leading-[1.8] text-[#5F6B64]">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 選ばれる理由 ────────────────────────────────────────── */}
      <section className="bg-white">
        <div className="mx-auto max-w-[1100px] px-5 py-20">
          <h2 className="mb-10 text-center text-[clamp(19px,4vw,26px)] font-bold text-[#1F2A24]">選ばれる理由</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {REASONS.map((r) => (
              <div
                key={r.title}
                className="rounded-2xl border border-[#E3EAE4] bg-white p-6 shadow-[0_1px_3px_rgba(31,42,36,0.04)]"
              >
                <div className="text-[15px] font-bold text-[#06C755]">{r.title}</div>
                <div className="mt-2 text-[14px] leading-[1.85] text-[#5F6B64]">{r.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing CTA ────────────────────────────────────────── */}
      <section className="bg-[#F3F7F4]">
        <div className="mx-auto max-w-[720px] px-5 py-20 text-center">
          <h2 className="text-[clamp(19px,4vw,26px)] font-bold text-[#1F2A24]">個人利用なら、すぐに始められます。</h2>
          <p className="mx-auto mt-4 max-w-[540px] text-[14px] leading-[1.95] text-[#5F6B64]">
            まずは1作品から。LINE公式アカウントと組み合わせて、物語体験の制作を始められます。
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login?mode=register"
              className="rounded-full bg-[#06C755] px-8 py-3 text-[15px] font-bold text-white shadow-sm transition hover:-translate-y-px hover:brightness-105"
            >
              今すぐ登録する
            </Link>
            <Link
              href="/pricing"
              className="rounded-full border border-[#E3EAE4] bg-white px-8 py-3 text-[15px] font-bold text-[#1F2A24] transition hover:bg-[#F3F7F4]"
            >
              料金プランを見る
            </Link>
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────── */}
      <section id="faq" className="bg-white">
        <div className="mx-auto max-w-[1100px] px-5 py-20">
          <h2 className="mb-10 text-center text-[clamp(19px,4vw,26px)] font-bold text-[#1F2A24]">よくある質問</h2>
          <LandingFaq />
        </div>
      </section>

      {/* ── Bottom CTA ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#F8FAF8]">
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#06C755]/[0.07] blur-3xl" />
        <div className="relative mx-auto flex max-w-[720px] flex-col items-center gap-6 px-5 py-24 text-center">
          <h2 className="text-[clamp(20px,5vw,32px)] font-black text-[#1F2A24]">あなたの物語を、LINEの中に。</h2>
          <LandingEmailForm source="bottom" />
          <Link href="/pricing" className="text-[13px] font-medium text-[#5F6B64] underline-offset-4 transition hover:text-[#06C755] hover:underline">
            プランを見る
          </Link>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-[#E3EAE4] bg-[#F7FAF7]">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-5 py-12 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="font-round text-[15px] font-black tracking-[0.14em] text-[#1F2A24]">WHALE STUDIO</div>
            <p className="mt-2 text-[12px] text-[#5F6B64]">LINEでつくる物語体験</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-[#5F6B64]">
            <Link href="/pricing" className="transition hover:text-[#06C755]">料金プラン</Link>
            {/* 公開ページ未整備のためリンク化しない（リンク切れ防止）。後続PRで /terms 等を公開予定。 */}
            <span className="text-[#9aa49d]">利用規約</span>
            <span className="text-[#9aa49d]">プライバシーポリシー</span>
            <span className="text-[#9aa49d]">特定商取引法に基づく表示</span>
            <span className="text-[#9aa49d]">お問い合わせ</span>
          </nav>
        </div>
        <div className="border-t border-[#E3EAE4] py-5 text-center text-[11px] text-[#9aa49d]">
          © Whale Studio
        </div>
      </footer>
    </div>
  );
}
