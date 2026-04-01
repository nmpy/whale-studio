// src/app/api/debug/route.ts
// GET /api/debug — 認証不要の環境変数診断エンドポイント
//
// ★ 本番運用前にこのファイルごと削除すること。
//
// 使い方:
//   curl https://whale-studio.vercel.app/api/debug
//
// 確認できること:
//   - BYPASS_AUTH の実際の値（Vercel 側で正しく設定されているか）
//   - NODE_ENV
//   - Supabase 設定の有無
//
// 機密情報（キー本体）は出力しない。

import { NextResponse } from "next/server";

export const runtime = "nodejs"; // Edge でなく Node.js で動かす

export async function GET() {
  const bypassRaw = process.env.BYPASS_AUTH;
  const bypassOn  = bypassRaw?.trim().toLowerCase() === "true";

  const info = {
    // ★ Vercel ログで BYPASS_AUTH の実値を確認するためのフィールド
    BYPASS_AUTH_raw:      bypassRaw ?? "(未設定)",
    BYPASS_AUTH_resolved: bypassOn,

    NODE_ENV:             process.env.NODE_ENV ?? "(未設定)",

    // Supabase — 設定の有無のみ（値は出さない）
    SUPABASE_URL_set:     !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_set:    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,

    // データベース — 接続文字列は出さない（設定有無のみ）
    DATABASE_URL_set:     !!process.env.DATABASE_URL,

    timestamp: new Date().toISOString(),
  };

  console.log("[Debug] env check:", info);

  return NextResponse.json({ ok: true, ...info });
}
