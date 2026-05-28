// src/components/landing/LandingHeader.tsx
// 公開LPのヘッダー（Server Component）。
// 認証状態は page.tsx 側で getServerUser して props で渡す。
// - 未ログイン: ログイン / 今すぐ始める
// - ログイン済: 管理画面へ /（権限があれば）スタジオ管理
//
// トーン: 既存 Studio.site 風の明るい / 透過白 + blur。

import Link from "next/link";

interface Props {
  isLoggedIn: boolean;
  canAccessAdmin: boolean;
}

export function LandingHeader({ isLoggedIn, canAccessAdmin }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-[#E3EAE4] bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1100px] items-center justify-between gap-4 px-5">
        {/* 左: ロゴ + タグライン */}
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-round text-[17px] font-black tracking-[0.14em] text-[#1F2A24]">
            WHALE STUDIO
          </span>
          <span className="hidden text-[11px] text-[#8a948d] sm:inline">
            LINEでつくる物語体験 β版
          </span>
        </Link>

        {/* 中央: nav（PCのみ） */}
        <nav className="hidden items-center gap-7 md:flex">
          <a href="#features" className="text-[13px] font-medium text-[#5F6B64] transition hover:text-[#1F2A24]">機能</a>
          <Link href="/pricing" className="text-[13px] font-medium text-[#5F6B64] transition hover:text-[#1F2A24]">料金</Link>
          <a href="#faq" className="text-[13px] font-medium text-[#5F6B64] transition hover:text-[#1F2A24]">よくある質問</a>
        </nav>

        {/* 右: CTA（認証状態で出し分け） */}
        <div className="flex items-center gap-2.5">
          {isLoggedIn ? (
            <>
              {canAccessAdmin && (
                <Link
                  href="/admin"
                  className="hidden rounded-full border border-[#E3EAE4] px-4 py-2 text-[13px] font-bold text-[#1F2A24] transition hover:bg-[#F3F7F4] sm:inline-block"
                >
                  スタジオ管理
                </Link>
              )}
              <Link
                href="/oas"
                className="rounded-full bg-[#06C755] px-5 py-2 text-[13px] font-bold text-white shadow-sm transition hover:-translate-y-px hover:brightness-105"
              >
                管理画面へ
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-full border border-[#E3EAE4] px-4 py-2 text-[13px] font-bold text-[#1F2A24] transition hover:bg-[#F3F7F4]"
              >
                ログイン
              </Link>
              <Link
                href="/login?mode=register"
                className="rounded-full bg-[#06C755] px-5 py-2 text-[13px] font-bold text-white shadow-sm transition hover:-translate-y-px hover:brightness-105"
              >
                今すぐ始める
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
