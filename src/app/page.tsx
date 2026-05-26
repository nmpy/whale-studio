"use client";

// src/app/page.tsx
// トップページ。デザインガイド §5 に準拠した中央ヒーローレイアウト。
// 構成: eyebrow badge → wordmark → tagline → 補足コピー → primary CTA → secondary link → 最近使ったアカウント

import { useEffect, useState } from "react";
import Link from "next/link";
import { buttonClass } from "@/components/shared";
import { oaApi, getDevToken, type OaListItem } from "@/lib/api-client";

export default function LandingPage() {
  const [recents, setRecents] = useState<OaListItem[]>([]);

  useEffect(() => {
    oaApi.list(getDevToken(), { page: 1, limit: 3 })
      .then((r) => setRecents(r.data))
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-56px)] max-w-[640px] flex-col items-center justify-center gap-12 px-5 py-12 sm:py-16">
      {/* ── ヒーロー ───────────────────────────────────────────── */}
      <section className="flex flex-col items-center gap-5 text-center">
        {/* eyebrow badge */}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-[11px] font-bold tracking-[0.06em] text-brand-ink">
          β版
        </span>

        {/* wordmark */}
        <h1 className="font-round text-[clamp(32px,7vw,44px)] font-black leading-none tracking-[0.04em] text-[#1f2a25]">
          WHALE STUDIO
        </h1>

        {/* tagline */}
        <p className="font-round text-[clamp(15px,3.5vw,17px)] font-bold tracking-[0.04em] text-ink">
          LINEでつくる物語体験
        </p>

        {/* 補足コピー */}
        <p className="max-w-[440px] text-[13px] leading-[1.9] text-ink-2 sm:text-[14px]">
          マーダーミステリー・謎解き・周遊企画など、
          <br className="hidden sm:block" />
          メッセージ・LIFF・チェックイン・分岐をまとめて管理。
          <br />
          <span className="text-ink-3">
            小規模な個人制作から商用公演・イベント運用まで。
          </span>
        </p>

        {/* CTA cluster */}
        <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <Link
            href="/oas"
            className={buttonClass({
              variant:   "primary",
              size:      "md",
              className: "!px-8 !py-3 !text-[14px]",
            })}
          >
            体験をつくる
          </Link>
          <Link
            href="/pricing"
            className="text-[12px] font-bold text-ink-2 underline decoration-line decoration-1 underline-offset-4 transition-colors hover:text-brand-ink hover:decoration-brand"
          >
            プランを見る
          </Link>
        </div>
      </section>

      {/* ── 最近使ったアカウント ────────────────────────────── */}
      {recents.length > 0 && (
        <section className="flex flex-col items-center gap-3">
          <span className="font-num text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
            Recent accounts
          </span>
          <div className="flex flex-wrap justify-center gap-2">
            {recents.map((oa) => (
              <Link
                key={oa.id}
                href={`/oas/${oa.id}/works`}
                className="rounded-full border border-line bg-surface px-4 py-1.5 text-[13px] text-ink-2 transition-all hover:-translate-y-px hover:border-brand hover:text-brand-ink hover:shadow-card"
              >
                {oa.title}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
