// src/app/api/internal/cleanup/checkin-attempts/route.ts
// POST /api/internal/cleanup/checkin-attempts — CheckinAttempt の retention cleanup
//
// ■ 認証: CRON_SECRET 環境変数による secret 認証
//   Authorization: Bearer <CRON_SECRET>
//   secret 未設定 or 不一致 → 401
//
// ■ パラメータ (JSON body):
//   retentionDays?: number  — 保持日数（デフォルト 90）
//   dryRun?:        boolean — true なら削除せず件数だけ返す
//
// ■ 実行方法:
//   Vercel Cron:
//     vercel.json に cron 定義 → この route を POST で呼ぶ
//   curl:
//     curl -X POST https://your-domain/api/internal/cleanup/checkin-attempts \
//       -H "Authorization: Bearer $CRON_SECRET" \
//       -H "Content-Type: application/json" \
//       -d '{"dryRun": false}'
//
// ■ 環境変数:
//   CRON_SECRET — 内部 API 保護用シークレット。未設定なら route は 401 を返す。

import { NextRequest, NextResponse } from "next/server";
import { cleanupOldAttempts, RETENTION_DAYS } from "@/lib/checkin-attempt";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // ── secret 認証 ──
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { success: false, error: "CRON_SECRET is not configured" },
      { status: 401 },
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  // ── パラメータ ──
  let retentionDays = RETENTION_DAYS;
  let dryRun = false;

  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.retentionDays === "number" && body.retentionDays >= 1) {
      retentionDays = body.retentionDays;
    }
    if (body.dryRun === true) {
      dryRun = true;
    }
  } catch {
    // body なしでもデフォルトで実行
  }

  // ── cleanup 実行 ──
  try {
    const result = await cleanupOldAttempts(retentionDays, dryRun);

    console.log(
      `[cleanup] CheckinAttempt`,
      `dryRun=${result.dryRun}`,
      `retentionDays=${result.retentionDays}`,
      `cutoff=${result.cutoffDate}`,
      `deleted=${result.deletedCount}`,
    );

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error("[cleanup] CheckinAttempt error:", err);
    return NextResponse.json(
      { success: false, error: "Cleanup failed" },
      { status: 500 },
    );
  }
}
