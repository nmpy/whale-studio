import type { Metadata } from "next";
import { Quicksand } from "next/font/google";
import { ToastProvider } from "@/components/Toast";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

// ⚠ パフォーマンス (2nd pass) — 管理画面から日本語 Web フォントを撤去:
//
//   旧: root layout で Zen Maru Gothic + Zen Kaku Gothic New を next/font/google で
//       全画面適用していた。両者とも日本語フォントで、next/font は CJK を多数の
//       unicode-range subset に分割するため build 時 .next/static/media が
//       ~1350 ファイル / 29MB に膨張。共通 layout に乗るため**全管理画面**の初期表示で
//       数百リクエスト・数 MB を引き起こし、「管理画面全体が遅い / 真っ白待ち」の主因だった。
//       preload:false は描画ブロックを減らすだけで、生成ファイル / Network request /
//       転送量は残るため根本対策にならない。
//
//   新: 管理画面 (= app.whale-studio.app) は速度優先。Zen Maru / Zen Kaku を撤去し、
//       --font-round / --font-body は globals.css の **システム日本語フォントスタック**に
//       フォールバックさせる (= Web フォントの DL ゼロ)。数字・英数字用の Quicksand のみ残す
//       (latin subset = 数ファイルと軽量)。
//
//   影響範囲 (= 安全性):
//     - LIFF プレイヤー (/liff): 独自に @fontsource/line-seed-jp を読み込むため**無影響**。
//     - ブランドページ (/whale/in-ice): 見出しは独自 Noto Serif JP で**無影響**。本文のみ
//       system フォントに寄るが、ブランド表現の主体は見出し + 専用カラーのため軽微。
//     - 管理画面: 本文・見出しが system 日本語フォントになる (= デザインガイド §2/§6 とは
//       トレードオフ。速度優先の明示的判断。--font-zen-* を再注入すれば元に戻せる)。
const quicksand = Quicksand({
  subsets: ["latin"],
  weight:  ["500", "600", "700"],
  display: "swap",
  variable: "--font-quicksand",
});

export const metadata: Metadata = {
  title: "Whale Studio",
  description: "LINEで物語体験をつくるスタジオ",
  icons: {
    icon: "/favicon.ico",
  },
  // app.whale-studio.app は管理アプリ。公開 LP（STUDIO / whale-studio.app）とは別物なので
  // 検索インデックス対象にしない（robots.ts と合わせて二重に noindex / no-crawl）。
  metadataBase: new URL("https://app.whale-studio.app"),
  robots: { index: false, follow: false },
  openGraph: {
    title: "Whale Studio",
    description: "LINEで物語体験をつくるスタジオ",
    url: "https://app.whale-studio.app",
    siteName: "Whale Studio",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Whale Studio",
      },
    ],
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Whale Studio",
    description: "LINEで物語体験をつくるスタジオ",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={quicksand.variable}>
      <body>
        <ToastProvider>
          {/* CMS では <AppHeader /> + container を被せ、/liff/* ではどちらも被せない。
              詳細は AppShell.tsx を参照。 */}
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
