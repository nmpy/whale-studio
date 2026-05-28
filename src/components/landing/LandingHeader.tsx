// src/components/landing/LandingHeader.tsx
// 公開LPのヘッダー（Server Component）。
// 認証状態は page.tsx 側で getServerUser して props で渡す。
// - 未ログイン: ログイン / 今すぐ始める
// - ログイン済: 管理画面へ /（権限があれば）スタジオ管理

import Link from "next/link";

interface Props {
  isLoggedIn: boolean;
  canAccessAdmin: boolean;
}

export function LandingHeader({ isLoggedIn, canAccessAdmin }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#020617]/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-4 px-5">
        {/* 左: ロゴ + タグライン */}
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-round text-[17px] font-black tracking-[0.04em] text-white">
            WHALE STUDIO
          </span>
          <span className="hidden text-[11px] text-[#A7B0AA] sm:inline">
            LINEでつくる物語体験 β版
          </span>
        </Link>

        {/* 中央: nav（PCのみ） */}
        <nav className="hidden items-center gap-7 md:flex">
          <a href="#features" className="text-[13px] font-medium text-[#A7B0AA] transition hover:text-white">機能</a>
          <Link href="/pricing" className="text-[13px] font-medium text-[#A7B0AA] transition hover:text-white">料金</Link>
          <a href="#faq" className="text-[13px] font-medium text-[#A7B0AA] transition hover:text-white">よくある質問</a>
        </nav>

        {/* 右: CTA（認証状態で出し分け） */}
        <div className="flex items-center gap-2.5">
          {isLoggedIn ? (
            <>
              {canAccessAdmin && (
                <Link
                  href="/admin"
                  className="hidden rounded-lg border border-white/15 px-4 py-2 text-[13px] font-bold text-white transition hover:bg-white/10 sm:inline-block"
                >
                  スタジオ管理
                </Link>
              )}
              <Link
                href="/oas"
                className="rounded-lg bg-[#06C755] px-5 py-2 text-[13px] font-bold text-white transition hover:brightness-110"
              >
                管理画面へ
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg border border-white/15 px-4 py-2 text-[13px] font-bold text-white transition hover:bg-white/10"
              >
                ログイン
              </Link>
              <Link
                href="/login?mode=register"
                className="rounded-lg bg-[#06C755] px-5 py-2 text-[13px] font-bold text-white transition hover:brightness-110"
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
