// src/app/api/cron/broadcast-worker/route.ts
// GET/POST /api/cron/broadcast-worker — 配信メッセージ（Broadcast）の送信 worker。
//
// ■ 認証: CRON_SECRET（既存 /api/cron/scheduled-messages / uzu-outbox と同方式）。
//     Authorization: Bearer <CRON_SECRET>。**未設定は fail closed で 401**、不一致も 401。
//     管理画面のセッションを cron 認証の代用にはしない。secret はログにもレスポンスにも出さない。
//
// ■ live mode は **ENABLE_BROADCAST_WORKER=true** のときだけ。未設定なら dryRun
//     （対象の選択だけ行い、LINE 送信も DB 更新も一切しない）。
//     本番デプロイ直後に env 未設定でも勝手に送信が始まらない安全側（uzu-outbox と同じ方針）。
//
// ■ 対象は **管理者が明示的に開始した status="sending" の Broadcast だけ**。
//     draft を cron が勝手に送ることはない。予約配信もここでは扱わない。
//
// ■ レスポンス・ログは件数のみ。lineUserId / 本文 / channelAccessToken / CRON_SECRET は出さない。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processBroadcastChunk } from "@/lib/broadcast/processor";
import {
  runBroadcastWorker, WORKER_MAX_BROADCASTS, WORKER_TIME_BUDGET_MS,
} from "@/lib/broadcast/worker";

export const dynamic = "force-dynamic";
// 既存 broadcast process API と同じ上限。worker 側の wall-clock 予算はこれより短く取る。
export const maxDuration = 60;

function isLiveModeEnabled(): boolean {
  return process.env.ENABLE_BROADCAST_WORKER === "true";
}

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ success: false, error: "CRON_SECRET is not configured" }, { status: 401 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const dryRun = !isLiveModeEnabled();
  console.log("[line:broadcast:worker:start]", JSON.stringify({ dryRun }));

  const result = await runBroadcastWorker(
    {
      // status="sending" のみ。draft / sent / partial_failed / failed / cancelled は対象外。
      listSendingBroadcasts: (take) =>
        prisma.broadcast.findMany({
          where:   { status: "sending" },
          orderBy: { startedAt: "asc" },
          take,
          select:  { id: true, oaId: true },
        }),
      // 送信ロジックは admin API と同じ shared service をそのまま使う（複製しない）。
      processChunk: (args) => processBroadcastChunk(args),
    },
    { dryRun, maxBroadcasts: WORKER_MAX_BROADCASTS, timeBudgetMs: WORKER_TIME_BUDGET_MS },
  );

  console.log("[line:broadcast:worker:complete]", JSON.stringify(result));

  return NextResponse.json({ success: true, ...result });
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
