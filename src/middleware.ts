// src/middleware.ts
//
// 【暫定】@supabase/ssr 未インストールのため no-op。
//
// 本命有効化手順:
//   1. npm install @supabase/ssr
//   2. このファイルを下記の実装に差し替える
//
// ─── 差し替え用コード ────────────────────────────────────────
//
// import { NextRequest, NextResponse } from "next/server";
// import { createServerClient } from "@supabase/ssr";
//
// export async function middleware(req: NextRequest) {
//   const res = NextResponse.next();
//   const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
//   const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
//   if (!supabaseUrl || !supabaseAnonKey) return res;
//   const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
//     cookies: {
//       getAll()                   { return req.cookies.getAll(); },
//       setAll(cookiesToSet) {
//         for (const { name, value, options } of cookiesToSet) {
//           res.cookies.set(name, value, options);
//         }
//       },
//     },
//   });
//   await supabase.auth.getUser(); // access_token を refresh して cookie を更新
//   return res;
// }
//
// export const config = {
//   matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
// };
//
// ────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
