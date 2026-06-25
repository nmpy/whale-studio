// src/app/api/cron/scheduled-messages/route.ts
// GET/POST /api/cron/scheduled-messages — 時間差メッセージ worker（PR-4b: real push + live mode）。
//
// ■ 認証: CRON_SECRET（既存 /api/internal/cleanup と同方式）。
//     Authorization: Bearer <CRON_SECRET>。未設定/不一致は 401（未認証で外部実行不可）。
//     Vercel Cron は GET で叩き、CRON_SECRET env がある場合 Authorization: Bearer <CRON_SECRET> を
//     自動付与する。よって GET（Vercel Cron 用）と POST（手動/既存）両方で同じ認証・処理を行う。
// ■ live mode は **ENABLE_SCHEDULED_MESSAGE_WORKER=true** のときだけ。未設定/それ以外は dryRun
//     （DB を一切変更しない・実 push しない）。本番デプロイ直後に env 未設定なら勝手に push が走らない安全側。
//     - live:   claim(pending→sending) → cancel 判定 → **real LINE push** → sent / failed / retry、
//               および sending 滞留の recover（安全側 failed 化）。push は通数を消費する。
//     - dryRun: findDuePending + getUserProgress を読むだけ。何件 send/cancel/recover されるか数えるのみ。
// ■ レスポンスは件数のみ（claimed/sent/canceled/failed/retried/skipped/recovered/errors/dryRun）。
//     lineUserId・本文・channelAccessToken・CRON_SECRET 等の PII/token/secret は返さない・ログにも出さない。
// ■ vercel.json への cron schedule は **本 PR では追加しない**（自動実行されない）。
//     env flag が false なら dryRun になることを確認後、PR-4c 以降で schedule 登録を検討する。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  runScheduledMessageWorker, noopSender, DEFAULT_BATCH_SIZE, STUCK_SENDING_MS,
  type ScheduledWorkerDb, type PendingScheduledRow, type UserProgressState, type ScheduledSender,
} from "@/lib/scheduled-message-worker";
import { createScheduledPushSender, pushScheduledMessage, buildLineMessagesFromPayload } from "@/lib/scheduled-message-sender";
import { makeResumeChain } from "@/lib/scheduled-message-resume";
import { armScheduledMessages } from "@/lib/scheduled-message-arm";
import { fetchPhaseWithIncludes } from "@/lib/runtime";
import { isHoldChainTruncationEnabled } from "@/lib/scheduled-message";
import type { LineSender, LineMessage } from "@/lib/line";

export const dynamic = "force-dynamic";

/**
 * live mode（実 push）は ENABLE_SCHEDULED_MESSAGE_WORKER=true のときだけ。
 * 未設定/それ以外は dryRun（DB を変更しない・実 push しない）= 本番デプロイ直後に勝手に走らない安全側。
 */
function isLiveModeEnabled(): boolean {
  return process.env.ENABLE_SCHEDULED_MESSAGE_WORKER === "true";
}

async function handle(req: NextRequest) {
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
        select:  {
          id: true, workId: true, lineUserId: true, userProgressId: true, phaseId: true,
          cancelPolicyJson: true, oaId: true, payloadJson: true, retryCount: true,
          sourceMessageId: true, // PR-SER3: resume ログ追跡用（id のみ）
        },
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
    async markFailed(id, reason, retryCount, _now) {
      await prisma.scheduledLineMessage.update({
        where: { id },
        data:  { status: "failed", lastError: reason, retryCount },
      });
    },
    async markRetry(id, retryCount, lastError, nextDueAt) {
      // pending へ戻し、次回 dueAt（backoff）まで待つ。次回 cron が拾う。
      await prisma.scheduledLineMessage.update({
        where: { id },
        data:  { status: "pending", retryCount, lastError, dueAt: nextDueAt },
      });
    },
    async findStuckSending({ now, thresholdMs, limit }) {
      const cutoff = new Date(now.getTime() - thresholdMs);
      return prisma.scheduledLineMessage.findMany({
        where:   { status: "sending", updatedAt: { lt: cutoff } },
        orderBy: { updatedAt: "asc" },
        take:    limit,
        select:  { id: true, retryCount: true },
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

  // ── live / dryRun の決定 ──
  //   ENABLE_SCHEDULED_MESSAGE_WORKER=true のときだけ real push（live）。未設定は dryRun（DB 変更なし・実 push なし）。
  const live = isLiveModeEnabled();

  // real sender: channelAccessToken は OA から都度解決し、ここで初めて使う（戻り値/ログに出さない）。
  const realSender: ScheduledSender = createScheduledPushSender({
    resolveChannelToken: async (oaId) => {
      const oa = await prisma.oa.findUnique({ where: { id: oaId }, select: { channelAccessToken: true } });
      return oa?.channelAccessToken ?? null;
    },
    resolveSender: async (characterId): Promise<LineSender | null> => {
      const c = await prisma.character.findUnique({ where: { id: characterId }, select: { name: true, iconImageUrl: true } });
      if (!c) return null;
      const iconUrl = c.iconImageUrl && c.iconImageUrl.startsWith("https://") ? c.iconImageUrl : undefined;
      return { name: c.name, ...(iconUrl ? { iconUrl } : {}) };
    },
  });

  // ── PR-SER3 resume アダプタ（live かつ ENABLE_SCHEDULED_HOLD_CHAIN_TRUNCATION のときだけ注入）──
  //   予約 push 成功後に payload.resume.next_message_id から後続チェーンを送信し、後続に予約があれば再arm。
  //   flag OFF / dryRun では undefined（worker 側でも resume しない＝二重ガード）。token はここでのみ解決し出力しない。
  const resumeChain = (live && isHoldChainTruncationEnabled())
    ? makeResumeChain({
        fetchPhaseMessages: async ({ phaseId }) => {
          if (!phaseId) return null;
          const phase = await fetchPhaseWithIncludes(phaseId); // isActive のみ・character 込み
          return phase?.messages ?? null;
        },
        pushChain: async ({ row, messages }) => {
          const token = await prisma.oa.findUnique({ where: { id: row.oaId }, select: { channelAccessToken: true } })
            .then((o) => o?.channelAccessToken ?? null);
          if (!token) return { ok: false, reason: "token_not_found" };
          // RuntimePhaseMessage → LINE message（text/image のみ。character は drain 出力から sender 復元）。
          const lineMsgs: LineMessage[] = [];
          for (const m of messages) {
            const iconUrl = m.character?.icon_image_url && m.character.icon_image_url.startsWith("https://")
              ? m.character.icon_image_url : undefined;
            const sender: LineSender | undefined = m.character ? { name: m.character.name, ...(iconUrl ? { iconUrl } : {}) } : undefined;
            lineMsgs.push(...buildLineMessagesFromPayload(
              { message_type: m.message_type, body: m.body, asset_url: m.asset_url, character_id: m.character?.id ?? null },
              sender,
            ));
          }
          if (lineMsgs.length === 0) return { ok: false, reason: "empty_after_convert" };
          // LINE push は1回最大5通。retryKey は予約 id 由来で安定（同一 resume の二重送信を LINE 側でも抑止）。
          for (let i = 0; i < lineMsgs.length; i += 5) {
            const chunk = lineMsgs.slice(i, i + 5);
            const res = await pushScheduledMessage({
              lineUserId: row.lineUserId, messages: chunk, channelAccessToken: token,
              retryKey: `${row.id}:resume:${i / 5}`,
            });
            if (!res.ok) return { ok: false, reason: "push_failed" };
          }
          return { ok: true };
        },
        rearm: async ({ row, sentMessageIds, now }) => {
          const r = await armScheduledMessages({
            sentMessageIds, oaId: row.oaId, workId: row.workId,
            lineUserId: row.lineUserId, userProgressId: row.userProgressId, now,
          });
          return { created: r.created };
        },
      })
    : undefined;

  try {
    const result = await runScheduledMessageWorker({
      db, getUserProgress, now: new Date(), batchSize: DEFAULT_BATCH_SIZE,
      sender: live ? realSender : noopSender,
      resumeChain,
      dryRun: !live,
    });
    // 件数のみ返す（PII/token なし）。STUCK_SENDING_MS は recover 閾値（参考にコメント）。
    console.log("[cron:scheduled-messages]", JSON.stringify({ live, stuckThresholdMs: STUCK_SENDING_MS, ...result }));
    return NextResponse.json({ success: true, data: result });
  } catch {
    // 例外内容は PII を含み得るため詳細はログに出さない。
    console.error("[cron:scheduled-messages] worker failed");
    return NextResponse.json({ success: false, error: "Worker failed" }, { status: 500 });
  }
}

// Vercel Cron は GET で叩く。手動/既存呼び出し用に POST も同じ処理で受ける。
export const GET = handle;
export const POST = handle;
