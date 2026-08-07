// src/app/api/cron/uzu-outbox/route.ts
// GET/POST /api/cron/uzu-outbox — UZU Pro CMS 連携イベントの送信 worker。
//
// ■ 認証: CRON_SECRET（既存 /api/cron/scheduled-messages と同方式）。
//     Authorization: Bearer <CRON_SECRET>。未設定 / 不一致は 401。
//     Vercel Cron は GET で叩き、CRON_SECRET があれば Authorization を自動付与する。
//
// ■ live mode は **ENABLE_UZU_OUTBOX_WORKER=true** のときだけ。未設定なら dryRun
//     （DB を一切変更せず、実 HTTP 送信もしない）。本番デプロイ直後に env 未設定なら
//     勝手に送信が始まらない安全側。
//
// ■ 送信先: UZU_BASE_URL + UZU_EVENTS_SECRET。未設定なら DB を変更せず skipped を返す。
//
// ■ レスポンスは件数のみ。lineUserId / 予約番号 / secret はログにもレスポンスにも出さない。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runUzuOutboxWorker, DEFAULT_BATCH_SIZE } from "@/lib/uzu-outbox-worker";

export const dynamic = "force-dynamic";

function isLiveModeEnabled(): boolean {
  return process.env.ENABLE_UZU_OUTBOX_WORKER === "true";
}

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ success: false, error: "CRON_SECRET が未設定です" }, { status: 401 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const dryRun = !isLiveModeEnabled();
  const result = await runUzuOutboxWorker(prisma, {
    now:        new Date(),
    dryRun,
    baseUrl:    process.env.UZU_BASE_URL ?? null,
    secret:     process.env.UZU_EVENTS_SECRET ?? null,
    batchSize:  DEFAULT_BATCH_SIZE,
  });

  return NextResponse.json({ success: true, ...result });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
