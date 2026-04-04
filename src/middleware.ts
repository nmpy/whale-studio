// src/middleware.ts
// Supabase Auth セッションガード
//
// 動作:
//   NEXT_PUBLIC_SUPABASE_URL 未設定  → 常に通過（開発環境 BYPASS モード）
//   NEXT_PUBLIC_SUPABASE_URL 設定済み → 下記ルール適用
//
// ルール:
//   保護ルート（/oas, /playground, /nazotoki）かつ未認証
//     → /login?next=<元パス> にリダイレクト
//   /login かつ認証済み
//     → ?next= の値 または /oas にリダイレクト（二重ログイン防止）
//   上記以外
//     → 通過（cookie を refresh して返す）
//
// ⚠ workspace membership / status のチェックはここでは行わない。
//   DB アクセスが必要なため API ルート / クライアントサイドで処理する。

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// ── 保護対象ルートのプレフィックス ──────────────────────────────────
const PROTECTED_PREFIXES = ["/oas", "/playground", "/nazotoki"];

// ── 認証不要のパブリックルート ──────────────────────────────────────
// /login, /access-denied, /api/line/** (LINE webhook), /t/**, /tester/**
const PUBLIC_PREFIXES = [
  "/login",
  "/access-denied",
  "/api/line/",
  "/t/",
  "/tester/",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

function isPublicPrefix(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p)
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Supabase 未設定 → 開発バイパスモード ──────────────────────────
  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // 開発環境（BYPASS_AUTH=true 相当）: 認証なしで全ルート通過
    return NextResponse.next();
  }

  // ── Supabase SSR クライアント + cookie refresh ────────────────────
  // setAll で supabaseResponse を差し替えることで、
  // refresh された access_token cookie が必ずレスポンスに含まれる。
  let supabaseResponse = NextResponse.next({ request: req });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // request side: 後続の Server Component がリフレッシュ済み cookie を読める
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        // response side: ブラウザへ Set-Cookie を返す
        supabaseResponse = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // ⚠ getUser() を必ず呼ぶことで access_token が期限切れなら refresh される
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ── 保護ルート: 未認証 → /login へ ──────────────────────────────
  if (isProtected(pathname) && !user) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── /login: 認証済み → リダイレクト先 or /oas へ ─────────────────
  if (pathname === "/login" && user) {
    const next  = req.nextUrl.searchParams.get("next");
    const dest  = req.nextUrl.clone();
    // ?next= が保護ルートの場合のみ信頼する（open redirect 防止）
    dest.pathname = next && isProtected(next) ? next : "/oas";
    dest.search   = "";
    return NextResponse.redirect(dest);
  }

  // ── その他: refresh 済み cookie を乗せて通過 ─────────────────────
  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * 以下を除くすべてのパスにマッチ:
     *   - _next/static (静的ファイル)
     *   - _next/image  (画像最適化)
     *   - favicon.ico
     *   - 画像・フォント等の静的アセット
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
