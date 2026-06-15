// src/app/liff/w/[workPublicId]/layout.tsx
// 作品ホーム(/liff/w/[workPublicId]) と 個別ページ(/liff/w/[workPublicId]/p/[pagePublicId]) を
// まとめてカバーする **server layout**。配下の page は "use client" のため generateMetadata を
// 置けないので、ここで作品単位の OG / Twitter メタ情報を出す。
//
// 方針（共有時の見え方）:
//   title / og:title / twitter:title = 作品タイトル
//   description / og:description / twitter:description = 作品説明文（空なら安全 fallback）
//   canonical / og:url = 作品ホーム URL（現URLに合わせる）

import type { Metadata } from "next";
import { findWorkByIdOrPublicId } from "@/lib/public-id-resolver";
import { parseLiffHomeSettings, homeFontWrapperClass } from "@/components/liff/liff-style-helpers";

const FALLBACK_TITLE = "Whale Studio";
const FALLBACK_DESC = "LINEで物語体験をつくる作品です。";

function baseUrl(): string {
  const env = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  return env ? env.replace(/\/$/, "") : "https://app.whale-studio.app";
}

export async function generateMetadata(
  { params }: { params: Promise<{ workPublicId: string }> },
): Promise<Metadata> {
  const { workPublicId } = await params;

  let title = FALLBACK_TITLE;
  let description = FALLBACK_DESC;
  try {
    const work = await findWorkByIdOrPublicId(workPublicId);
    if (work?.title?.trim()) title = work.title.trim();
    const d = work?.description?.trim();
    description = d && d.length > 0 ? d : (work?.title?.trim() ? `${work.title.trim()}｜Whale Studio` : FALLBACK_DESC);
  } catch {
    // フォールバックのまま（メタ情報のためにページ表示を妨げない）
  }

  const url = `${baseUrl()}/liff/w/${workPublicId}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function LiffWorkLayout(
  { children, params }: { children: React.ReactNode; params: Promise<{ workPublicId: string }> },
) {
  // ホーム（作品単位）フォントを LIFF ホーム + 配下の各 LIFF ページにカスケード適用する。
  // 未設定/"default" は wrapperClass="" となり従来挙動（既存データ非影響）。失敗時も従来挙動。
  let wrapperClass = "";
  try {
    const { workPublicId } = await params;
    const work = await findWorkByIdOrPublicId(workPublicId);
    const home = parseLiffHomeSettings((work as { liffHomeSettingsJson?: unknown } | null)?.liffHomeSettingsJson);
    wrapperClass = homeFontWrapperClass(home.font_family);
  } catch {
    // フォント解決失敗はページ表示を妨げない（従来フォントで表示）。
  }
  return wrapperClass ? <div className={wrapperClass}>{children}</div> : <>{children}</>;
}
