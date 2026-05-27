// src/app/contact/page.tsx
// 法人利用・導入サポートのご相談ページ (Server Component)。
// クエリ ?type=enterprise / ?type=onboarding を読んで、初期選択値だけを
// クライアント側フォーム (_content.tsx) に渡す。
//
// 注: 送信は POST /api/feedback に相乗り。将来 /api/contact に差し替える場合は
//     _content.tsx 内の fetch 1 箇所だけを書き換えれば良い構造にしてある。

import type { Metadata } from "next";
import ContactContent, { type ContactIntent } from "./_content";

export const metadata: Metadata = {
  title: "法人利用・導入サポートのご相談 | Whale Studio",
  description:
    "商業公演、IP 企画、複数アカウント運用、初期設定サポートをご希望の方はこちらからお問い合わせください。",
};

function normalizeIntent(raw: string | string[] | undefined): ContactIntent {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "onboarding") return "onboarding";
  if (v === "production") return "production";
  if (v === "other")      return "other";
  // デフォルトおよび ?type=enterprise は 法人利用 を選択
  return "enterprise";
}

export default function ContactPage({
  searchParams,
}: {
  // Next.js 14: searchParams は同期的に渡される (pricing/page.tsx と同じパターン)。
  searchParams: { type?: string | string[] };
}) {
  const initialIntent = normalizeIntent(searchParams.type);

  return (
    <div className="mx-auto max-w-[560px] px-5 py-10 sm:py-14">
      <header className="mb-8 flex flex-col gap-3">
        <h1 className="font-round text-[clamp(22px,5vw,28px)] font-black text-[#1f2a25]">
          法人利用・導入サポートのご相談
        </h1>
        <p className="text-[13.5px] leading-[1.9] text-ink-2">
          商業公演、IP 企画、複数アカウント運用、初期設定サポートをご希望の方は
          こちらからお問い合わせください。
        </p>
      </header>

      <ContactContent initialIntent={initialIntent} />
    </div>
  );
}
