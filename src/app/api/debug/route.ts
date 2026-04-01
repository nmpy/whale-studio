// src/app/api/debug/route.ts
// GET /api/debug — 認証不要の環境変数・DB接続診断エンドポイント
//
// ★ 本番運用前にこのファイルごと削除すること。
//
// 使い方:
//   curl https://whale-studio.vercel.app/api/debug

import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** postgresql://user:pass@host:port/db?params を分解してマスク付きで返す */
function parseDbUrl(raw: string | undefined): Record<string, string> {
  if (!raw) return { status: "未設定" };

  try {
    // postgresql:// or postgres:// に対応
    const url = new URL(raw);

    const username  = url.username || "(空)";
    const host      = url.hostname  || "(空)";
    const port      = url.port      || "(デフォルト)";
    const database  = url.pathname.replace(/^\//, "") || "(空)";
    const params    = url.search    || "(なし)";

    // パスワードはマスク
    const passwordSet = !!url.password;

    // Supabase pooler かどうかの判定
    const isPooler     = host.includes("pooler.supabase.com");
    const port6543     = url.port === "6543";
    const port5432     = url.port === "5432";

    // username が postgres.<project-ref> 形式かチェック
    const usernameOk   = /^postgres\..+/.test(username);

    // pgbouncer パラメータの有無
    const hasPgbouncer = url.searchParams.get("pgbouncer") === "true";
    const hasConnLimit = url.searchParams.has("connection_limit");

    // 推奨 URI の組み立て（project-ref を username から抽出）
    let suggestedFix: string | null = null;
    if (isPooler && !usernameOk) {
      // host が aws-0-ap-northeast-1.pooler.supabase.com の場合
      // project-ref は通常 Supabase ダッシュボードの URL から取得する
      suggestedFix =
        "username を postgres.<project-ref> 形式に変更してください。" +
        " 例: postgres.ostqyhjxgiincgrlhyao";
    }

    return {
      scheme:           url.protocol.replace(":", ""),
      username,
      username_ok:      String(usernameOk),
      password_set:     String(passwordSet),
      host,
      port,
      database,
      params,
      is_pooler:        String(isPooler),
      port_6543:        String(port6543),
      port_5432:        String(port5432),
      has_pgbouncer:    String(hasPgbouncer),
      has_conn_limit:   String(hasConnLimit),
      ...(suggestedFix ? { suggested_fix: suggestedFix } : {}),
      // 診断サマリ
      diagnosis: [
        isPooler   ? "✅ pooler host" : "⚠️ direct host (pooler 非使用)",
        usernameOk ? "✅ username OK (postgres.<ref>)" : "❌ username NG (postgres.<ref> 形式が必要)",
        hasPgbouncer ? "✅ pgbouncer=true" : "⚠️ pgbouncer=true なし",
        port6543   ? "✅ port 6543 (transaction mode)" :
          port5432 ? "⚠️ port 5432 (session mode)" : `port ${port}`,
      ].join(" / "),
    };
  } catch (e) {
    return { status: "パース失敗", error: String(e) };
  }
}

/** DB 接続を実際に試みてレイテンシを返す */
async function pingDb(): Promise<{ ok: boolean; latency_ms?: number; error?: string }> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latency_ms: Date.now() - start };
  } catch (e) {
    return {
      ok:    false,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }
}

export async function GET() {
  const bypassRaw = process.env.BYPASS_AUTH;
  const bypassOn  = bypassRaw?.trim().toLowerCase() === "true";

  const dbUrlRaw  = process.env.DATABASE_URL;
  const dbParsed  = parseDbUrl(dbUrlRaw);
  const dbPing    = await pingDb();

  const info = {
    // Auth
    BYPASS_AUTH_raw:      bypassRaw      ?? "(未設定)",
    BYPASS_AUTH_resolved: bypassOn,

    // Runtime
    NODE_ENV:             process.env.NODE_ENV ?? "(未設定)",

    // Supabase（有無のみ）
    SUPABASE_URL_set:     !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_set:    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,

    // DB 接続診断
    db_url_set:           !!dbUrlRaw,
    db_parsed:            dbParsed,
    db_ping:              dbPing,

    timestamp: new Date().toISOString(),
  };

  console.log("[Debug]", JSON.stringify(info, null, 2));

  return NextResponse.json({ ok: true, ...info });
}
