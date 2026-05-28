// src/app/page.tsx
// 公開ランディングページ（Server Component）。
// 個人クリエイター向けに「何のサービスか」「どう始めるか」を提示する集客LP。
//
// - 認証状態は getServerUser で取得し、右上CTAを出し分ける。
// - メール入力 / FAQ のみ client component（LandingEmailForm / LandingFaq）。
// - AppShell 側で "/" は bare layout（AppHeader / container なし）に設定済み。

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
    <div className="min-h-screen bg-[#020617] text-white">
      <LandingHeader isLoggedIn={isLoggedIn} canAccessAdmin={canAccessAdmin} />

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <LandingMockCards />
        {/* 深海グラデーションのオーバーレイ */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#020617]/70 via-[#03110a]/85 to-[#020617]" />
        <div className="relative mx-auto flex max-w-[820px] flex-col items-center gap-6 px-5 py-24 text-center sm:py-32">
          <h1 className="font-round text-[clamp(30px,7vw,52px)] font-black leading-[1.15] tracking-[0.02em]">
            LINEで、物語体験をつくろう。
          </h1>
          <p className="max-w-[600px] text-[15px] leading-[1.9] text-[#cbd5d1] sm:text-[16px]">
            マーダーミステリー、謎解き、周遊企画、舞台連動コンテンツまで。
            <br className="hidden sm:block" />
            メッセージ・LIFF・チェックイン・分岐をまとめて管理できます。
          </p>
          <p className="text-[13px] text-[#A7B0AA]">
            個人利用なら、登録後すぐに制作を始められます。
          </p>
          <div className="mt-2 flex w-full flex-col items-center gap-3">
            <LandingEmailForm source="hero" />
            <Link href="/pricing" className="text-[13px] font-medium text-[#A7B0AA] underline-offset-4 transition hover:text-white hover:underline">
              プランを見る
            </Link>
          </div>
        </div>
      </section>

      {/* ── Use Case Strip ─────────────────────────────────────── */}
      <section className="border-t border-white/5 bg-[#03110a]">
        <div className="mx-auto max-w-[1180px] px-5 py-16">
          <h2 className="mb-8 text-center text-[clamp(20px,4vw,28px)] font-bold">
            個人制作から、商業公演・イベント運用まで。
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-5">
            {USE_CASES.map((u) => (
              <div
                key={u.title}
                className="min-w-[220px] flex-1 rounded-xl border border-white/10 bg-gradient-to-br from-[#0b3d2e]/60 to-[#03110a] p-5 transition hover:-translate-y-1 hover:border-[#06C755]/40 sm:min-w-0"
              >
                <div className="text-[15px] font-bold text-white">{u.title}</div>
                <div className="mt-2 text-[12px] leading-[1.7] text-[#A7B0AA]">{u.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── できること（横スクロール）────────────────────────────── */}
      <section id="features" className="bg-[#020617]">
        <div className="mx-auto max-w-[1180px] px-5 py-20">
          <h2 className="mb-8 text-[clamp(20px,4vw,28px)] font-bold">Whale Studioでできること</h2>
          <div className="flex gap-5 overflow-x-auto pb-4">
            {FEATURES.map((f) => (
              <div
                key={f.n}
                className="relative flex min-w-[260px] flex-col justify-end overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0a1f3a] via-[#072a3a] to-[#03110a] p-6 transition hover:-translate-y-1 sm:min-w-[300px]"
                style={{ minHeight: 200 }}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -bottom-6 left-3 font-num text-[120px] font-black leading-none text-white/[0.06]"
                >
                  {f.n}
                </span>
                <div className="relative">
                  <div className="text-[16px] font-bold text-white">{f.title}</div>
                  <div className="mt-2 text-[13px] leading-[1.7] text-[#A7B0AA]">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 選ばれる理由 ────────────────────────────────────────── */}
      <section className="border-t border-white/5 bg-[#03110a]">
        <div className="mx-auto max-w-[1180px] px-5 py-20">
          <h2 className="mb-8 text-center text-[clamp(20px,4vw,28px)] font-bold">選ばれる理由</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {REASONS.map((r) => (
              <div key={r.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
                <div className="text-[16px] font-bold text-[#06C755]">{r.title}</div>
                <div className="mt-2 text-[14px] leading-[1.85] text-[#cbd5d1]">{r.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing CTA ────────────────────────────────────────── */}
      <section className="bg-[#020617]">
        <div className="mx-auto max-w-[760px] px-5 py-20 text-center">
          <h2 className="text-[clamp(20px,4vw,28px)] font-bold">個人利用なら、すぐに始められます。</h2>
          <p className="mx-auto mt-4 max-w-[560px] text-[14px] leading-[1.9] text-[#A7B0AA]">
            まずは1作品から。LINE公式アカウントと組み合わせて、物語体験の制作を始められます。
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login?mode=register"
              className="rounded-lg bg-[#06C755] px-8 py-3 text-[15px] font-bold text-white transition hover:brightness-110"
            >
              今すぐ登録する
            </Link>
            <Link
              href="/pricing"
              className="rounded-lg border border-white/15 px-8 py-3 text-[15px] font-bold text-white transition hover:bg-white/10"
            >
              料金プランを見る
            </Link>
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────── */}
      <section id="faq" className="border-t border-white/5 bg-[#03110a]">
        <div className="mx-auto max-w-[1180px] px-5 py-20">
          <h2 className="mb-8 text-center text-[clamp(20px,4vw,28px)] font-bold">よくある質問</h2>
          <LandingFaq />
        </div>
      </section>

      {/* ── Bottom CTA ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#020617]">
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b3d2e]/40 to-transparent" />
        <div className="relative mx-auto flex max-w-[760px] flex-col items-center gap-6 px-5 py-24 text-center">
          <h2 className="text-[clamp(22px,5vw,34px)] font-black">あなたの物語を、LINEの中に。</h2>
          <LandingEmailForm source="bottom" />
          <Link href="/pricing" className="text-[13px] font-medium text-[#A7B0AA] underline-offset-4 transition hover:text-white hover:underline">
            プランを見る
          </Link>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-white/10 bg-[#020617]">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-12 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="font-round text-[15px] font-black tracking-[0.04em] text-white">WHALE STUDIO</div>
            <p className="mt-2 text-[12px] text-[#A7B0AA]">LINEでつくる物語体験</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-[#A7B0AA]">
            <Link href="/pricing" className="transition hover:text-white">料金プラン</Link>
            {/* 公開ページ未整備のためリンク化しない（リンク切れ防止）。後続PRで /terms 等を公開予定。 */}
            <span className="opacity-60">利用規約</span>
            <span className="opacity-60">プライバシーポリシー</span>
            <span className="opacity-60">特定商取引法に基づく表示</span>
            <span className="opacity-60">お問い合わせ</span>
          </nav>
        </div>
        <div className="border-t border-white/5 py-5 text-center text-[11px] text-[#6b7770]">
          © Whale Studio
        </div>
      </footer>
    </div>
  );
}
