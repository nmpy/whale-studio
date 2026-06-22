// src/app/api/cron/scheduled-messages/route.ts
// POST /api/cron/scheduled-messages — 時間差メッセージ worker（PR-4a 土台）。
//
// ■ 認証: CRON_SECRET（既存 /api/internal/cleanup と同方式）。
//     Authorization: Bearer <CRON_SECRET>。未設定/不一致は 401（未認証で外部実行不可）。
// ■ PR-4a: **実 LINE push は行わない**（no-op sender）。dueAt<=now の pending を atomic claim し
//     （pending→sending）、キャンセル判定して canceled にするまで。送信は PR-4b の real sender。
// ■ レスポンスは件数のみ（claimed/canceled/skipped/sent/errors）。lineUserId・本文等の PII/token は返さない。
// ■ 本 PR では vercel.json に cron schedule を **追加しない**（自動実行されない）。
//     PR-4b で real sender を入れてからスケジュール登録する。手動/PR-4b までは secret 付き呼び出しのみ。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  runScheduledMessageWorker, noopSender, DEFAULT_BATCH_SIZE,
  type ScheduledWorkerDb, type PendingScheduledRow, type UserProgressState,
} from "@/lib/scheduled-message-worker";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // ── secret 認証 ──
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ success: false, error: "CRON_SECRET is not configured" }, { status: 401 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // ── prisma アダプタ（claim は updateMany where status=pending で atomic = 二重処理防止）──
  const db: ScheduledWorkerDb = {
    async findDuePending({ now, limit }) {
      return prisma.scheduledLineMessage.findMany({
        where:   { status: "pending", dueAt: { lte: now } },
        orderBy: { dueAt: "asc" },
        take:    limit,
        select:  { id: true, workId: true, lineUserId: true, userProgressId: true, phaseId: true, cancelPolicyJson: true },
      });
    },
    async claimToSending(id) {
      const r = await prisma.scheduledLineMessage.updateMany({
        where: { id, status: "pending" },
        data:  { status: "sending" }, // updatedAt は @updatedAt が自動更新
      });
      return r.count;
    },
    async markCanceled(id, reason, now) {
      await prisma.scheduledLineMessage.update({
        where: { id },
        data:  { status: "canceled", canceledAt: now, lastError: reason },
      });
    },
    async markSent(id, requestId, now) {
      await prisma.scheduledLineMessage.update({
        where: { id },
        data:  { status: "sent", sentAt: now, lineRequestId: requestId },
      });
    },
  };

  const getUserProgress = async (row: PendingScheduledRow): Promise<UserProgressState | null> => {
    const up = row.userProgressId
      ? await prisma.userProgress.findUnique({
          where: { id: row.userProgressId }, select: { currentPhaseId: true, reachedEnding: true },
        })
      : await prisma.userProgress.findUnique({
          where: { lineUserId_workId: { lineUserId: row.lineUserId, workId: row.workId } },
          select: { currentPhaseId: true, reachedEnding: true },
        });
    return up ? { currentPhaseId: up.currentPhaseId, reachedEnding: up.reachedEnding } : null;
  };

  try {
    // PR-4a: noopSender（実 push しない）。now はサーバ時刻。
    const result = await runScheduledMessageWorker({
      db, getUserProgress, now: new Date(), batchSize: DEFAULT_BATCH_SIZE, sender: noopSender,
    });
    // 件数のみ返す（PII なし）。
    console.log("[cron:scheduled-messages]", JSON.stringify(result));
    return NextResponse.json({ success: true, data: result });
  } catch {
    // 例外内容は PII を含み得るため詳細はログに出さない。
    console.error("[cron:scheduled-messages] worker failed");
    return NextResponse.json({ success: false, error: "Worker failed" }, { status: 500 });
  }
}
