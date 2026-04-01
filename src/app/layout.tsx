import type { Metadata } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import { ToastProvider } from "@/components/Toast";
import AppHeader from "@/components/AppHeader";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const notoSansJP = Noto_Sans_JP({ subsets: ["latin"], variable: "--font-noto" });

export const metadata: Metadata = {
  title: "WHALE STUDIO | LINEでつくる物語体験 β版",
  description: "WHALE STUDIO | LINEでつくる物語体験 β版 管理ツール",
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
