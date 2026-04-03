import type { Metadata } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import { ToastProvider } from "@/components/Toast";
import AppHeader from "@/components/AppHeader";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const notoSansJP = Noto_Sans_JP({ subsets: ["latin"], variable: "--font-noto" });

export const metadata: Metadata = {
  title: "Whale Studio",
  description: "LINEで物語体験をつくるスタジオ",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "Whale Studio",
    description: "LINEで物語体験をつくるスタジオ",
    url: "https://whale-studio.app", // 本番URLに合わせて変更してください
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
    <html lang="ja" className={`${inter.variable} ${notoSansJP.variable}`}>
      <body>
        <ToastProvider>
          <AppHeader />
          <main>
            <div className="container">{children}</div>
          </main>
        </ToastProvider>
      </body>
    </html>
  );
}
