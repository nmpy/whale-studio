// src/lib/broadcast/service.ts
//
// 配信メッセージの開始処理（BroadcastService）。**配信専用**。
//
// 既存「応答メッセージ」の webhook / reply / runtime 経路からは呼ばれないし、
// こちらからも呼ばない。共有するのは lib/line.ts の LINE 送信基盤だけ。
//
// 二重配信防止の考え方:
//   status の draft → sending は compare-and-swap（updateMany の where に status:"draft"）。
//   既に sending 以降なら count=0 になり、開始処理は何もしない。
//   ダブルクリック / reload / HTTP retry / Server Action 重複 / 並行リクエストの
//   いずれでも「2 回目以降は no-op」に落ちる。
//   さらに BroadcastRecipient は @@unique(broadcastId, lineUserId) を持つため、
//   仮に snapshot が二重に走っても同じ宛先の行は増えない（最終防壁）。

import { prisma } from "@/lib/prisma";
import { resolveBroadcastAudience, type BroadcastTarget } from "./audience";
import { RETRY_KEY_TTL_MS, AMBIGUOUS_REASON } from "./processor";

export type StartBroadcastResult =
  | { ok: true; recipientCount: number }
  /** 既に開始済み（二重実行）。エラーではなく冪等な no-op として扱う。 */
  | { ok: false; reason: "already_started"; status: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "empty_audience" };

/** Broadcast の targetType/segmentId/segmentWorkId から BroadcastTarget を作る。 */
export function toBroadcastTarget(b: {
  targetType: string;
  segmentId: string | null;
  segmentWorkId: string | null;
}): BroadcastTarget | null {
  if (b.targetType === "all") return { type: "all" };
  if (b.targetType === "segment" && b.segmentId && b.segmentWorkId) {
    return { type: "segment", segmentId: b.segmentId, workId: b.segmentWorkId };
  }
  return null;
}

/**
 * 配信を開始する。
 *   1. draft であることを確認して宛先を解決（サーバー側でのみ解決する）
 *   2. draft → sending を CAS で確定
 *   3. 同一トランザクションで宛先を snapshot（以後 Segment 条件が変わっても宛先は動かない）
 *
 * 実送信はここでは行わない。processBroadcastChunk() が chunk 単位で送る。
 */
export async function startBroadcast(args: {
  oaId: string;
  broadcastId: string;
}): Promise<StartBroadcastResult> {
  const { oaId, broadcastId } = args;

  // OA スコープ込みで取得（他 OA の配信を触れない）
  const broadcast = await prisma.broadcast.findFirst({
    where: { id: broadcastId, oaId },
    select: { id: true, status: true, targetType: true, segmentId: true, segmentWorkId: true },
  });
  if (!broadcast) return { ok: false, reason: "not_found" };
  if (broadcast.status !== "draft") {
    return { ok: false, reason: "already_started", status: broadcast.status };
  }

  const target = toBroadcastTarget(broadcast);
  if (!target) return { ok: false, reason: "not_found" };

  const { lineUserIds } = await resolveBroadcastAudience(oaId, target);
  if (lineUserIds.length === 0) return { ok: false, reason: "empty_audience" };

  const startedAt = new Date();

  // CAS + snapshot を同一トランザクションで行う。
  // 「sending なのに宛先が無い」状態を作らない。
  const claimed = await prisma.$transaction(async (tx) => {
    const res = await tx.broadcast.updateMany({
      where: { id: broadcastId, oaId, status: "draft" }, // ← CAS の肝
      data: {
        status: "sending",
        startedAt,
        recipientCount: lineUserIds.length,
        successCount: 0,
        failureCount: 0,
      },
    });
    if (res.count !== 1) return false; // 並行実行に負けた = 2 回目以降

    await tx.broadcastRecipient.createMany({
      data: lineUserIds.map((lineUserId) => ({ broadcastId, lineUserId })),
      skipDuplicates: true, // @@unique(broadcastId, lineUserId) と合わせた最終防壁
    });
    return true;
  });

  if (!claimed) {
    const fresh = await prisma.broadcast.findFirst({
      where: { id: broadcastId, oaId },
      select: { status: true },
    });
    return { ok: false, reason: "already_started", status: fresh?.status ?? "unknown" };
  }

  console.log("[line:broadcast:start]", JSON.stringify({
    broadcastId, oaId, recipientCount: lineUserIds.length, targetType: broadcast.targetType,
  }));

  return { ok: true, recipientCount: lineUserIds.length };
}

/**
 * 失敗した宛先だけを再送対象に戻す。
 * sent / skipped の宛先には絶対に触れない（= 二重送信しない）。
 *
 * 再送可否は LINE の retry key 仕様に合わせて 2 つに分ける:
 *
 *   - **LINE が受理していないと確定できる失敗**（4xx。ただし 409 は sent 済みなのでここに来ない）
 *     → いつでも安全に再送できる。同じ retry key を使うが、LINE 側に受理記録が無いため
 *       新規リクエストとして扱われても二重配信にならない。
 *   - **受理されたか分からない失敗**（timeout でステータス無し / 5xx）
 *     → 同じ retry key が有効な 24 時間以内なら再送してよい（既に受理済みなら 409 が返る）。
 *       24 時間を過ぎるとキーが失効し、再送は「新規リクエスト」になって二重配信になり得るため
 *       **再送しない**。skipped にして運用者の確認対象にする。
 *
 * 429（レート制限）は受理されていないので再送可能。ここでの再送は運用者の明示操作なので
 * 自動での即時無限リトライにはならない。
 */
export async function retryFailedRecipients(args: {
  oaId: string;
  broadcastId: string;
}): Promise<{ ok: boolean; requeued: number; skipped?: number; reason?: "not_found" | "not_retryable" }> {
  const { oaId, broadcastId } = args;

  const broadcast = await prisma.broadcast.findFirst({
    where: { id: broadcastId, oaId },
    select: { id: true, status: true },
  });
  if (!broadcast) return { ok: false, requeued: 0, reason: "not_found" };
  // 送信中のものを触ると進行中の worker と競合するため、完了系のみ再送可能にする
  if (!["partial_failed", "failed"].includes(broadcast.status)) {
    return { ok: false, requeued: 0, reason: "not_retryable" };
  }

  const retryKeyDead = new Date(Date.now() - RETRY_KEY_TTL_MS);

  const result = await prisma.$transaction(async (tx) => {
    // (1) 受理不明（httpStatus が null=timeout、または 5xx）かつ retry key 失効 → 再送しない
    const expired = await tx.broadcastRecipient.updateMany({
      where: {
        broadcastId,
        status:    "failed",
        createdAt: { lt: retryKeyDead },
        OR: [{ httpStatus: null }, { httpStatus: { gte: 500 } }],
      },
      data: { status: "skipped", errorMessage: AMBIGUOUS_REASON },
    });

    // (2) 残りの failed を再送対象に戻す（sent / skipped には触れない）
    const res = await tx.broadcastRecipient.updateMany({
      where: { broadcastId, status: "failed" },
      data: { status: "pending", httpStatus: null, errorMessage: null },
    });
    if (res.count === 0) return { requeued: 0, skipped: expired.count };

    await tx.broadcast.updateMany({
      where: { id: broadcastId, oaId, status: { in: ["partial_failed", "failed"] } },
      data: { status: "sending", completedAt: null, failureCount: 0 },
    });
    return { requeued: res.count, skipped: expired.count };
  });

  console.log("[line:broadcast:retry]", JSON.stringify({
    broadcastId, oaId, requeued: result.requeued, skippedExpired: result.skipped,
  }));
  return { ok: true, requeued: result.requeued, skipped: result.skipped };
}
