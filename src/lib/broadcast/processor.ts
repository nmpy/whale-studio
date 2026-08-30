// src/lib/broadcast/processor.ts
//
// 配信メッセージの実送信（BroadcastProcessor）。**配信専用**。
//
// 1 リクエストで全宛先を送らず chunk 単位で進める。呼び出し側（API / cron）が
// hasMore=true の間だけ再度叩く。途中でタイムアウトしても、pending の宛先が
// 残っているだけなので次の chunk から安全に再開できる。
//
// webhook / reply 経路とは一切共有しない。ここから応答メッセージの送信関数を呼ばないし、
// 応答メッセージ側からこの processor を呼ばない。共通なのは pushToLine のみ。

import { prisma } from "@/lib/prisma";
import { pushToLine } from "@/lib/line";
import { parseBroadcastContent, toLineMessages } from "./content";

/** 1 回の process 呼び出しで送る最大件数。 */
export const BROADCAST_CHUNK_SIZE = 50;

/**
 * claim("sending") したまま動きが無い宛先を pending へ戻すまでの時間。
 * process が push 前後で落ちた場合の復旧用。実行中の行は updatedAt が新しいため対象外。
 */
export const STALE_CLAIM_MS = 5 * 60 * 1000;

/**
 * LINE の retry key(X-Line-Retry-Key) 有効期間。公式仕様で「初回リクエストから 24 時間」。
 * これを過ぎると同じキーを送っても **新規リクエスト扱い**になり得るため、
 * 「LINE が受理したかどうか分からない」宛先を自動で再 push してはいけない。
 */
export const RETRY_KEY_TTL_MS = 24 * 60 * 60 * 1000;

/** 送達可否が確定できなくなった宛先に残す理由（内部情報。lineUserId は含めない）。 */
export const AMBIGUOUS_REASON = "delivery status unknown; automatic retry window expired";

/**
 * LINE 公式の retry 方針（Retrying an API request）に沿った「再試行してよい失敗」の判定。
 *
 *   再試行してよい : timeout / ネットワーク失敗（status なし）、LINE server error（5xx）
 *   再試行しない   : 2xx、409（既受理）、その他 4xx（400/401/403/404/429 …）
 *                    公式に "Don't retry. Retries don't change the result." と明記されている。
 *
 * 429 も 4xx なのでここでは再試行対象にしない。レート制限 / 同一ユーザー送信制限 /
 * 月間上限など原因の解消が要るケースがあり、同じ操作で無条件に送り直す設計にしない。
 */
export function isRetryableFailure(httpStatus: number | null | undefined): boolean {
  return httpStatus == null || httpStatus >= 500;
}

/** 上の判定を Prisma の where 条件として表したもの（service と API で同じ定義を使う）。 */
export function retryableFailureWhere(): { OR: { httpStatus: null | { gte: number } }[] } {
  return { OR: [{ httpStatus: null }, { httpStatus: { gte: 500 } }] };
}

/**
 * 宛先に使う retry key。
 * BroadcastRecipient.id は Prisma の @default(uuid())（UUID v4 = hexadecimal UUID）なので
 * LINE の要求形式をそのまま満たす。初回 push・stale recovery・手動再送のいずれでも
 * 同じ行に対しては同じ値になるため、追加カラム / migration は不要。
 */
export function retryKeyOf(recipientId: string): string {
  return recipientId;
}

export type ProcessResult =
  | { ok: true; processed: number; sent: number; failed: number; skipped: number; hasMore: boolean; status: string }
  | { ok: false; reason: "not_found" | "not_sending" | "invalid_content" | "no_token" };

/**
 * 配信結果から最終 status を決める。
 * skipped（送達可否が確定できず自動再送を止めた宛先）は成功にも失敗にも数えないが、
 * 運用者の確認が要るため「全件成功」には倒さない。
 */
export function finalStatusOf(successCount: number, failureCount: number, skippedCount = 0): string {
  if (failureCount === 0 && skippedCount === 0) return "sent";
  if (successCount === 0) return "failed";
  return "partial_failed";
}

/**
 * pending の宛先を最大 BROADCAST_CHUNK_SIZE 件処理する。
 * 送信結果は宛先ごとに BroadcastRecipient へ記録する（成功/失敗の追跡と再送のため）。
 */
export async function processBroadcastChunk(args: {
  oaId: string;
  broadcastId: string;
  chunkSize?: number;
}): Promise<ProcessResult> {
  const { oaId, broadcastId } = args;
  const chunkSize = args.chunkSize ?? BROADCAST_CHUNK_SIZE;

  const broadcast = await prisma.broadcast.findFirst({
    where: { id: broadcastId, oaId },
    select: { id: true, status: true, contentJson: true, oa: { select: { channelAccessToken: true } } },
  });
  if (!broadcast) return { ok: false, reason: "not_found" };
  if (broadcast.status !== "sending") return { ok: false, reason: "not_sending" };

  const content = parseBroadcastContent(broadcast.contentJson);
  if (!content) return { ok: false, reason: "invalid_content" };

  const token = broadcast.oa.channelAccessToken;
  if (!token) return { ok: false, reason: "no_token" };

  const messages = toLineMessages(content);

  // ── 中断した claim の回収 ────────────────────────────────────
  // process が claim 直後（push 前後）に落ちると "sending" のまま残る。
  // この行は「LINE が受理したかどうか分からない」状態なので、扱いを 2 つに分ける。
  const now = Date.now();
  const staleBefore   = new Date(now - STALE_CLAIM_MS);
  const retryKeyDead  = new Date(now - RETRY_KEY_TTL_MS);

  // (1) retry key がまだ有効（初回 push から 24h 以内）→ pending に戻して同じ retry key で再 push。
  //     LINE が既に受理済みなら 409 が返り、下で sent として確定する（＝二重配信にならない）。
  //     createdAt は snapshot 時刻 = 初回 push より必ず前なので、これを基準にすると
  //     「まだ有効」と誤判定することはない（安全側）。
  await prisma.broadcastRecipient.updateMany({
    where: {
      broadcastId,
      status:    "sending",
      updatedAt: { lt: staleBefore },
      createdAt: { gte: retryKeyDead },
    },
    data: { status: "pending" },
  });

  // (2) retry key の有効期間を過ぎた ambiguous な行 → **自動で再 push しない**。
  //     同じキーを送っても新規リクエスト扱いになり得るため、再送は二重配信になり得る。
  //     failed にすると手動再送で拾われてしまうので skipped にし、運用者の確認対象にする。
  const expired = await prisma.broadcastRecipient.updateMany({
    where: {
      broadcastId,
      status:    "sending",
      updatedAt: { lt: staleBefore },
      createdAt: { lt: retryKeyDead },
    },
    data: { status: "skipped", errorMessage: AMBIGUOUS_REASON },
  });
  if (expired.count > 0) {
    console.warn("[line:broadcast:ambiguous-expired]", JSON.stringify({
      broadcastId, oaId, count: expired.count, reason: AMBIGUOUS_REASON,
    }));
  }

  const pending = await prisma.broadcastRecipient.findMany({
    where: { broadcastId, status: "pending" },
    select: { id: true, lineUserId: true },
    orderBy: { id: "asc" },
    take: chunkSize,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of pending) {
    // ── 宛先単位の atomic claim ──────────────────────────────
    // findMany は「読んだ時点のスナップショット」でしかないため、process が並行実行されると
    // 2 つのリクエストが同じ pending 行を読み得る。そのまま push すると二重送信になる。
    // そこで push の**前に** status を pending → sending へ CAS で確定させ、
    // count===1 を取れたリクエストだけが送信する（負けた側は skip）。
    // where に status:"pending" を含めるため、同じ行を 2 回 claim することはできない。
    const claim = await prisma.broadcastRecipient.updateMany({
      where: { id: r.id, status: "pending" },
      data:  { status: "sending" },
    });
    if (claim.count !== 1) {
      skipped++; // 並行する別の process が先に取った
      continue;
    }

    // pushToLine は例外を投げず {ok,status} を返す（ネットワークエラーも ok:false）。
    // retryKey は **初回 push から**必ず付ける（LINE 仕様: 付けずに送った request は再試行できない）。
    const res = await pushToLine(r.lineUserId, messages, token, { retryKey: retryKeyOf(r.id) });

    // 409 Conflict = 同じ retry key の request を LINE が **既に受理済み**。
    // 「失敗して未送信」ではないので failed にしてはいけない（再送すると二重配信になる）。
    // LINE 受理後・DB 更新前に落ちたケースはここで sent として確定する。
    const alreadyAccepted = !res.ok && res.status === 409;

    if (res.ok || alreadyAccepted) {
      sent++;
      if (alreadyAccepted) {
        console.log("[line:broadcast:already-accepted]", JSON.stringify({
          broadcastId, userId: r.lineUserId.slice(0, 8), status: 409,
          acceptedRequestId: res.acceptedRequestId ?? null,
        }));
      }
      await prisma.broadcastRecipient.update({
        where: { id: r.id },
        data: {
          status:       "sent",
          httpStatus:   res.status ?? 200,
          errorMessage: alreadyAccepted ? "already accepted by LINE (retry key conflict)" : null,
          sentAt:       new Date(),
          // ── observability only ──
          // LINE の応答ヘッダを記録するだけ。status 遷移・集計・retry 判定には使わない。
          // 409 では x-line-request-id は「却下された再試行」の ID で、実際に受理された
          // 送信は x-line-accepted-request-id 側なので、両方を分けて残す（LINE 公式仕様）。
          lineRequestId:         res.requestId ?? null,
          lineAcceptedRequestId: res.acceptedRequestId ?? null,
        },
      });
    } else {
      failed++;
      console.warn("[line:broadcast:recipient-failed]", JSON.stringify({
        broadcastId, userId: r.lineUserId.slice(0, 8), status: res.status ?? null,
        requestId: res.requestId ?? null,
      }));
      await prisma.broadcastRecipient.update({
        where: { id: r.id },
        data: {
          status: "failed",
          httpStatus: res.status ?? null,
          // 本文・PII は入れない。HTTP status だけを残す。
          errorMessage: res.status ? `LINE push failed (HTTP ${res.status})` : "LINE push failed",
          // 失敗時も request id は調査に使えるので残す（判定には使わない）。
          lineRequestId:         res.requestId ?? null,
          lineAcceptedRequestId: res.acceptedRequestId ?? null,
        },
      });
    }
  }

  // 集計は「宛先テーブルの実状態」から取り直す。
  // chunk が並行実行されてもカウンタが二重加算されない。
  const [successCount, failureCount, skippedCount, remaining] = await Promise.all([
    prisma.broadcastRecipient.count({ where: { broadcastId, status: "sent" } }),
    prisma.broadcastRecipient.count({ where: { broadcastId, status: "failed" } }),
    prisma.broadcastRecipient.count({ where: { broadcastId, status: "skipped" } }),
    // 未処理 = pending + 他の process が claim 中(sending)。
    // in-flight を残件に含めることで、並行実行中に片方が先に「完了」と確定させてしまうのを防ぐ。
    prisma.broadcastRecipient.count({ where: { broadcastId, status: { in: ["pending", "sending"] } } }),
  ]);

  const hasMore = remaining > 0;
  const status = hasMore ? "sending" : finalStatusOf(successCount, failureCount, skippedCount);

  await prisma.broadcast.updateMany({
    where: { id: broadcastId, oaId, status: "sending" },
    data: {
      successCount,
      failureCount,
      ...(hasMore ? {} : { status, completedAt: new Date() }),
    },
  });

  console.log(hasMore ? "[line:broadcast:progress]" : "[line:broadcast:complete]", JSON.stringify({
    broadcastId, oaId, processed: pending.length - skipped, skipped, successCount, failureCount, skippedCount, remaining, status,
  }));

  return { ok: true, processed: pending.length - skipped, sent, failed, skipped, hasMore, status };
}
