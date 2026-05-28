import type { Metadata } from "next";
import { Zen_Maru_Gothic, Zen_Kaku_Gothic_New, Quicksand } from "next/font/google";
import { ToastProvider } from "@/components/Toast";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

// デザインガイド §2: 3 種のフォントロール
// - font-round (Zen Maru Gothic) : 見出し・ボタン・ラベル・ロゴ
// - font-body  (Zen Kaku Gothic New) : 本文 (= body default)
// - font-num   (Quicksand) : 数値・英数字・日付
// Inter / Roboto / system フォントは禁止 (= ガイド §6 NG)。
const zenMaru = Zen_Maru_Gothic({
  subsets: ["latin"],
  weight:  ["500", "700", "900"],
  display: "swap",
  variable: "--font-zen-maru",
});
const zenKaku = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight:  ["400", "500", "700"],
  display: "swap",
  variable: "--font-zen-kaku",
});
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
    <html lang="ja" className={`${zenMaru.variable} ${zenKaku.variable} ${quicksand.variable}`}>
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
