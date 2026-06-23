// src/lib/scheduled-message-arm.ts
//
// 時間差メッセージ（予約送信）の「予約作成」runtime 接続（PR-4c-2）。
//   送信直後（applyFreeInputPostEffect の tail・DB 状態確定後）に、いま送ったメッセージのうち
//   scheduledMessageSettings.enabled=true のものについて ScheduledLineMessage を **pending 作成**する。
//   armCheckinTriggers（checkin-trigger.ts）と同じ「送信後に per-user runtime レコードを作る」パターン。
//
// 重要:
//   - **実 push は呼ばない**（push は PR-4b の cron worker が live flag のときだけ行う）。
//   - reply 本体は止めない（失敗は内部で握りつぶす・件数だけ返す）。fire-and-forget/sleep/setTimeout は使わない。
//   - **サーバ feature flag ENABLE_SCHEDULED_MESSAGE_RESERVATION=true のときだけ**作成する。
//     未設定なら scheduledMessageSettings があっても予約を作らない（本番は未設定のまま安全投入）。
//   - 冪等キーは createScheduledLineMessage 内で lineUserId:workId:sourceMessageId:_:dueAt(分) として
//     生成される。同一 webhook 処理内の重複（同 source を同分内に複数回送信）は 1 件に束ねる。
//     別ユーザー / 別 source / 別分 は別予約。replyToken は保存しない。
//   - PII（lineUserId 全体・本文・token）はログに出さない。

import { prisma } from "@/lib/prisma";
import { scheduledMessageSettingsSchema } from "@/lib/validations";
import {
  computeScheduledDueAt, buildCancelPolicy, createScheduledLineMessage,
  type ScheduledMessageDb, type ScheduledMessagePayload,
} from "@/lib/scheduled-message";

/** 予約作成を有効化するサーバ feature flag。未設定なら作成しない。 */
export function isScheduledReservationEnabled(): boolean {
  return process.env.ENABLE_SCHEDULED_MESSAGE_RESERVATION === "true";
}

export interface ArmScheduledMessagesArgs {
  /** 直近送信した messageId 群（applyFreeInputPostEffect の sentMessageIds）。 */
  sentMessageIds:  string[];
  oaId:            string;
  workId:          string;
  lineUserId:      string;
  userProgressId?: string | null;
  /** テスト用に注入可能（既定 new Date()）。 */
  now?:            Date;
}

export interface ArmScheduledMessagesResult { created: number; skipped: number; failed: number }

/** prisma を ScheduledMessageDb として薄くアダプト（id/status のみ返す）。 */
const reservationDb: ScheduledMessageDb = {
  findUnique: ({ where }) =>
    prisma.scheduledLineMessage.findUnique({ where, select: { id: true, status: true } }),
  create: ({ data }) =>
    prisma.scheduledLineMessage.create({ data, select: { id: true, status: true } }),
};

/**
 * 送信したメッセージの scheduledMessageSettings から ScheduledLineMessage(pending) を作成する。
 * flag 無効 / 送信なし / 設定なし・無効・不正・body 空 / delay 不正 は作らない（skip）。
 * 例外は内部で握りつぶし、reply 本体は止めない。件数のみ返す。
 */
export async function armScheduledMessages(args: ArmScheduledMessagesArgs): Promise<ArmScheduledMessagesResult> {
  const result: ArmScheduledMessagesResult = { created: 0, skipped: 0, failed: 0 };
  if (!isScheduledReservationEnabled()) return result;        // 本番 flag 未設定なら何もしない
  if (!args.sentMessageIds || args.sentMessageIds.length === 0) return result;

  try {
    // MSG_SELECT は触らず、別クエリで scheduledMessageSettings を持つ送信メッセージだけ拾う（armCheckinTriggers 同様）。
    const rows = await prisma.message.findMany({
      where:  { id: { in: args.sentMessageIds }, isActive: true, scheduledMessageSettings: { not: null } },
      select: { id: true, phaseId: true, scheduledMessageSettings: true },
    });
    if (rows.length === 0) return result;

    const now = args.now ?? new Date();

    for (const row of rows) {
      try {
        // 不正 JSON / schema 不一致は「データ起因」なので skip（failed = 一時的エラー用に取っておく）。
        let raw: unknown;
        try { raw = JSON.parse(row.scheduledMessageSettings ?? "null"); } catch { result.skipped++; continue; }
        const parsed = scheduledMessageSettingsSchema.safeParse(raw);
        if (!parsed.success) { result.skipped++; continue; }
        const s = parsed.data;
        // enabled かつ delay/body が有効なときだけ予約（schema で担保されているが二重チェック）。
        if (!s.enabled || s.delay_minutes == null || !s.body || !s.body.trim()) { result.skipped++; continue; }

        const dueAt = computeScheduledDueAt(now, s.delay_minutes); // 不正 delay は throw → 下の catch で failed
        const payload: ScheduledMessagePayload = {
          message_type: "text",
          body:         s.body,
          character_id: s.character_id ?? null,
        };
        // cancel 条件: source message の phase を expectedPhase として保存（その後別 phase へ進めば cancel）。
        const cancelPolicy = buildCancelPolicy({
          phaseId:              row.phaseId,
          cancelOnPhaseChange:  s.cancel_on_phase_change,
          cancelOnWorkComplete: s.cancel_on_work_completed,
          dedupeSameTrigger:    true,
        });

        const r = await createScheduledLineMessage(reservationDb, {
          oaId:           args.oaId,
          workId:         args.workId,
          lineUserId:     args.lineUserId,
          userProgressId: args.userProgressId ?? null,
          phaseId:        row.phaseId,
          sourceMessageId: row.id,
          triggerType:    "scheduled_setting",
          triggerEventId: null, // 同一 webhook 内重複は dueAt(分)+source で束ねる。replyToken は保存しない。
          dueAt,
          payload,
          cancelPolicy,
        });

        if (r.created) {
          result.created++;
          // PII なし: oaId/workId/sourceMessageId/delay のみ。本文・lineUserId 全体・token は出さない。
          console.log("[scheduled-arm] reserved", JSON.stringify({
            oaId: args.oaId, workId: args.workId, sourceMessageId: row.id, delayMinutes: s.delay_minutes,
          }));
        } else {
          result.skipped++; // 既存（同一冪等キー）→ 二重予約しない
        }
      } catch (err) {
        result.failed++;
        // PII を含み得る詳細は出さない。理由分類のみ。
        console.warn("[scheduled-arm] reserve failed", JSON.stringify({
          sourceMessageId: row.id, reason: err instanceof Error ? err.name : "error",
        }));
      }
    }
  } catch (err) {
    // 検索/全体失敗も reply 本体は止めない。
    console.warn("[scheduled-arm] query failed", JSON.stringify({ reason: err instanceof Error ? err.name : "error" }));
  }

  return result;
}
