// src/lib/beacon.ts
//
// LINE Beacon webhook イベントの処理ロジック。
//
// 設計方針:
//  - webhook ルートから呼び出すが、テスト容易性のため
//    Prisma / LINE 送信は依存注入（または引数）として受け取る。
//  - 必ず BeaconEventLog を作成して結果を残す（重複排除・障害解析に利用）。
//  - 1 イベントの失敗で webhook 全体を 500 にしないこと。

import type { PrismaClient } from "@prisma/client";
import { normalizeBeaconHwid, InvalidBeaconHwidError } from "@/lib/beacon-hwid";
import type { LineMessage } from "@/lib/line";
import { resolveDestinationUrl } from "@/lib/destination-url-builder";

// ────────────────────────────────────────────────
// 型
// ────────────────────────────────────────────────

/** LINE Beacon webhook event の最小定義 */
export type LineBeaconEvent = {
  type: "beacon";
  timestamp: number;
  replyToken?: string;
  source: { type?: string; userId?: string };
  webhookEventId?: string;
  deliveryContext?: { isRedelivery?: boolean };
  beacon: {
    hwid: string;
    /** "enter" | "stay" | "banner" — LINE 仕様 */
    type: string;
    dm?: string;
  };
};

/** webhook 側から渡される OA コンテキスト（最小限） */
export type BeaconOaContext = {
  id: string;
  channelAccessToken: string;
  /** OA サービス停止中（Oa.serviceSuspendedAt）。非 null なら送信しない。 */
  serviceSuspendedAt?: Date | null;
  /**
   * Beacon 連動が現在のプランで利用可能か（= Pro 相当 / FEATURE.location）。
   * 未指定（undefined）は「判定不要」として扱い、false のときのみ plan_blocked。
   */
  planAllowed?: boolean;
};

/**
 * messageId（DB の Message）を既存のメッセージ送信パイプライン（chain + 演出）で
 * LineMessage[] に解決するための注入関数。webhook 側から渡す（テスト時はモック）。
 * messageId 未設定/解決不能なら null を返す。
 */
export type BeaconMessageResolver = (args: {
  messageId: string;
  workId: string | null;
}) => Promise<LineMessage[] | null>;

/** LINE 送信ヘルパーの差し込みポイント（テスト時にモック差し替え） */
export interface BeaconLineGateway {
  /** replyToken を使って即時返信。失敗時は throw すること */
  reply: (replyToken: string, messages: LineMessage[]) => Promise<void>;
  /** push 送信（replyToken が無い／使えない場合）。失敗時は throw すること */
  push: (userId: string, messages: LineMessage[]) => Promise<void>;
}

export type BeaconActionStatus =
  | "sent"
  | "matched"
  | "ignored"
  | "cooldown"
  | "failed";

export type HandleBeaconResult = {
  status: BeaconActionStatus;
  /** デバッグ用: 処理を停止した理由 */
  reason?: string;
  triggerId?: string | null;
};

// 必要最小限の Prisma サブセット（テスト時はモックで差し替える）
type PrismaLike = Pick<PrismaClient, "beaconTrigger" | "beaconEventLog" | "lineDestination">;

// ────────────────────────────────────────────────
// アクション実行
// ────────────────────────────────────────────────

/**
 * trigger.actionType / actionPayload に応じて LINE メッセージを構築する。
 * 不正な設定の場合は null を返す（呼び出し側は failed として記録）。
 */
async function buildActionMessages(
  prisma: PrismaLike,
  trigger: {
    actionType: string;
    actionPayload: unknown;
    workId: string | null;
  },
  resolveMessage?: BeaconMessageResolver,
): Promise<LineMessage[] | null> {
  const payload = (trigger.actionPayload ?? {}) as Record<string, unknown>;

  switch (trigger.actionType) {
    // 登録済みメッセージ（messageId）を既存のメッセージ送信パイプラインで送る。
    // lag_ms / typing / loading / quickReply / chain など通常メッセージと同じ挙動になる。
    case "message": {
      const messageId = typeof payload.message_id === "string" ? payload.message_id.trim() : "";
      if (!messageId || !resolveMessage) return null; // message_not_configured
      const msgs = await resolveMessage({ messageId, workId: trigger.workId });
      return msgs && msgs.length > 0 ? msgs : null;
    }

    case "send_message": {
      const text = typeof payload.text === "string" ? payload.text.trim() : "";
      if (!text) return null;
      return [{ type: "text", text }];
    }

    case "destination": {
      const destinationId = typeof payload.destination_id === "string" ? payload.destination_id : null;
      if (!destinationId) return null;
      const dest = await prisma.lineDestination.findUnique({
        where: { id: destinationId },
      });
      if (!dest || !dest.isEnabled) return null;
      const url = resolveDestinationUrl({
        destinationType: dest.destinationType,
        liffTargetType:  dest.liffTargetType,
        urlOrPath:       dest.urlOrPath,
        queryParamsJson: dest.queryParamsJson as Record<string, string>,
        workId:          dest.workId,
      });
      if (!url) return null;
      const text = typeof payload.text === "string" && payload.text.trim()
        ? `${payload.text.trim()}\n${url}`
        : url;
      return [{ type: "text", text }];
    }

    case "noop":
      // 設定上「ログのみ」のトリガー。matched で記録するために空配列を返す。
      return [];

    default:
      return null;
  }
}

// ────────────────────────────────────────────────
// メイン処理
// ────────────────────────────────────────────────

/**
 * 1 件の LINE beacon イベントを処理する。
 *
 * 結果は必ず BeaconEventLog に保存される（webhookEventId は unique）。
 * 既存ログがある場合は二重実行を避け {status: "ignored", reason: "duplicate"} を返す。
 */
export async function handleBeaconEvent(args: {
  prisma: PrismaLike;
  oa: BeaconOaContext;
  event: LineBeaconEvent;
  line: BeaconLineGateway;
  /** messageId（DB Message）を LineMessage[] に解決する注入関数（action_type="message" 用）。 */
  resolveMessage?: BeaconMessageResolver;
  /** 現在時刻（テスト用に注入可） */
  now?: () => Date;
}): Promise<HandleBeaconResult> {
  const { prisma, oa, event, line, resolveMessage } = args;
  const now = args.now ?? (() => new Date());

  console.log(
    `[LINE Beacon] received oa=${oa.id} hwid="${event.beacon?.hwid ?? ""}" type=${event.beacon?.type ?? "-"} userId=${(event.source?.userId ?? "-").slice(0, 8)}`,
  );

  const lineUserId = event.source?.userId ?? null;
  const beaconType = event.beacon?.type ?? "";
  const deviceMessage = event.beacon?.dm ?? null;
  const isRedelivery = !!event.deliveryContext?.isRedelivery;
  const webhookEventId = event.webhookEventId
    ?? `synthetic:${oa.id}:${event.timestamp}:${event.beacon?.hwid ?? "unknown"}:${lineUserId ?? "anon"}`;

  // ── 1. 重複排除（webhookEventId 一意） ──
  const existing = await prisma.beaconEventLog.findUnique({
    where: { webhookEventId },
    select: { id: true, actionStatus: true, beaconTriggerId: true },
  });
  if (existing) {
    return {
      status: "ignored",
      reason: "duplicate webhookEventId",
      triggerId: existing.beaconTriggerId ?? null,
    };
  }

  // ── 2. HWID 正規化 ──
  let hwid: string;
  try {
    hwid = normalizeBeaconHwid(event.beacon?.hwid);
  } catch (e) {
    const msg = e instanceof InvalidBeaconHwidError ? e.message : "invalid hwid";
    await prisma.beaconEventLog.create({
      data: {
        oaId:           oa.id,
        workId:         null,
        beaconTriggerId: null,
        lineUserId,
        hwid:           String(event.beacon?.hwid ?? ""),
        beaconType,
        deviceMessage,
        webhookEventId,
        isRedelivery,
        actionStatus:   "ignored",
        errorMessage:   msg,
        rawEvent:       event as unknown as object,
      },
    });
    return { status: "ignored", reason: msg };
  }

  // ── 3. trigger 検索 ──
  const trigger = await prisma.beaconTrigger.findUnique({
    where: { oaId_hwid: { oaId: oa.id, hwid } },
  });

  if (!trigger) {
    console.log(`[LINE Beacon] unknown_beacon oa=${oa.id} hwid="${hwid}" userId=${(lineUserId ?? "-").slice(0, 8)}`);
    await prisma.beaconEventLog.create({
      data: {
        oaId:           oa.id,
        workId:         null,
        beaconTriggerId: null,
        lineUserId,
        hwid,
        beaconType,
        deviceMessage,
        webhookEventId,
        isRedelivery,
        actionStatus:   "unknown_beacon",
        errorMessage:   "no matching trigger",
        rawEvent:       event as unknown as object,
      },
    });
    return { status: "ignored", reason: "no matching trigger" };
  }

  // ── 4. enabled チェック ──
  if (!trigger.enabled) {
    await prisma.beaconEventLog.create({
      data: {
        oaId:           oa.id,
        workId:         trigger.workId,
        beaconTriggerId: trigger.id,
        lineUserId,
        hwid,
        beaconType,
        deviceMessage,
        webhookEventId,
        isRedelivery,
        actionStatus:   "ignored",
        errorMessage:   "trigger disabled",
        rawEvent:       event as unknown as object,
      },
    });
    return { status: "ignored", reason: "trigger disabled", triggerId: trigger.id };
  }

  // ── 4.5. OA サービス停止中 → 送信しない（既存のサービス停止仕様に従う）──
  if (oa.serviceSuspendedAt) {
    console.log(`[LINE Beacon] service_stopped oa=${oa.id} hwid=${hwid} trigger=${trigger.id}`);
    await prisma.beaconEventLog.create({
      data: {
        oaId: oa.id, workId: trigger.workId, beaconTriggerId: trigger.id, lineUserId,
        hwid, beaconType, deviceMessage, webhookEventId, isRedelivery,
        actionStatus: "service_stopped", errorMessage: "OA service suspended",
        rawEvent: event as unknown as object,
      },
    });
    return { status: "ignored", reason: "service_stopped", triggerId: trigger.id };
  }

  // ── 4.6. プラン gate（Beacon 連動は Pro 相当 / FEATURE.location）──
  if (oa.planAllowed === false) {
    console.log(`[LINE Beacon] plan_blocked oa=${oa.id} hwid=${hwid} trigger=${trigger.id}`);
    await prisma.beaconEventLog.create({
      data: {
        oaId: oa.id, workId: trigger.workId, beaconTriggerId: trigger.id, lineUserId,
        hwid, beaconType, deviceMessage, webhookEventId, isRedelivery,
        actionStatus: "plan_blocked", errorMessage: "plan does not allow beacon",
        rawEvent: event as unknown as object,
      },
    });
    return { status: "ignored", reason: "plan_blocked", triggerId: trigger.id };
  }

  // ── 5. eventTypes フィルタ（MVP: enter のみ想定）──
  const allowed = trigger.eventTypes.split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(beaconType)) {
    await prisma.beaconEventLog.create({
      data: {
        oaId:           oa.id,
        workId:         trigger.workId,
        beaconTriggerId: trigger.id,
        lineUserId,
        hwid,
        beaconType,
        deviceMessage,
        webhookEventId,
        isRedelivery,
        actionStatus:   "ignored",
        errorMessage:   `beaconType "${beaconType}" not in [${allowed.join(",")}]`,
        rawEvent:       event as unknown as object,
      },
    });
    return { status: "ignored", reason: "beacon type not allowed", triggerId: trigger.id };
  }

  // ── 6. cooldown チェック（同 lineUserId × triggerId の直近成功ログ）──
  if (lineUserId && trigger.cooldownSeconds > 0) {
    const cutoff = new Date(now().getTime() - trigger.cooldownSeconds * 1000);
    const recent = await prisma.beaconEventLog.findFirst({
      where: {
        beaconTriggerId: trigger.id,
        lineUserId,
        actionStatus: { in: ["sent", "matched"] },
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    });
    if (recent) {
      console.log(`[LINE Beacon] suppressed_cooldown oa=${oa.id} hwid=${hwid} trigger=${trigger.id} userId=${lineUserId.slice(0, 8)}`);
      await prisma.beaconEventLog.create({
        data: {
          oaId:           oa.id,
          workId:         trigger.workId,
          beaconTriggerId: trigger.id,
          lineUserId,
          hwid,
          beaconType,
          deviceMessage,
          webhookEventId,
          isRedelivery,
          actionStatus:   "cooldown",
          errorMessage:   `last sent at ${recent.createdAt.toISOString()}`,
          rawEvent:       event as unknown as object,
        },
      });
      return { status: "cooldown", reason: "within cooldown window", triggerId: trigger.id };
    }
  }

  // ── 7. アクション実行 ──
  let messages: LineMessage[] | null;
  try {
    messages = await buildActionMessages(prisma, {
      actionType:    trigger.actionType,
      actionPayload: trigger.actionPayload,
      workId:        trigger.workId,
    }, resolveMessage);
  } catch (e) {
    messages = null;
    console.warn("[beacon] buildActionMessages threw", e);
  }

  if (messages === null) {
    // action_type="message" で messageId 未設定/解決不能なら message_not_configured として扱う。
    const isMessageAction = trigger.actionType === "message";
    const status = isMessageAction ? "message_not_configured" : "failed";
    const reason = isMessageAction ? "message not configured" : `invalid action config (type=${trigger.actionType})`;
    console.log(`[LINE Beacon] ${status} oa=${oa.id} hwid=${hwid} trigger=${trigger.id}`);
    await prisma.beaconEventLog.create({
      data: {
        oaId:           oa.id,
        workId:         trigger.workId,
        beaconTriggerId: trigger.id,
        lineUserId,
        hwid,
        beaconType,
        deviceMessage,
        webhookEventId,
        isRedelivery,
        actionStatus:   status,
        errorMessage:   reason,
        rawEvent:       event as unknown as object,
      },
    });
    return { status: isMessageAction ? "ignored" : "failed", reason, triggerId: trigger.id };
  }

  // noop（ログ専用トリガー）の場合は matched で記録して終わり
  if (messages.length === 0) {
    await prisma.beaconEventLog.create({
      data: {
        oaId:           oa.id,
        workId:         trigger.workId,
        beaconTriggerId: trigger.id,
        lineUserId,
        hwid,
        beaconType,
        deviceMessage,
        webhookEventId,
        isRedelivery,
        actionStatus:   "matched",
        rawEvent:       event as unknown as object,
      },
    });
    return { status: "matched", triggerId: trigger.id };
  }

  // ── 8. LINE 送信（reply 優先、無ければ push）──
  let sendError: string | null = null;
  try {
    if (event.replyToken) {
      await line.reply(event.replyToken, messages);
    } else if (lineUserId) {
      await line.push(lineUserId, messages);
    } else {
      sendError = "no replyToken nor userId";
    }
  } catch (e) {
    sendError = e instanceof Error ? e.message : String(e);
  }

  await prisma.beaconEventLog.create({
    data: {
      oaId:           oa.id,
      workId:         trigger.workId,
      beaconTriggerId: trigger.id,
      lineUserId,
      hwid,
      beaconType,
      deviceMessage,
      webhookEventId,
      isRedelivery,
      actionStatus:   sendError ? "failed" : "sent",
      errorMessage:   sendError,
      rawEvent:       event as unknown as object,
    },
  });

  if (sendError) {
    console.log(`[LINE Beacon] failed oa=${oa.id} hwid=${hwid} trigger=${trigger.id} error="${sendError}"`);
    return { status: "failed", reason: sendError, triggerId: trigger.id };
  }
  console.log(`[LINE Beacon] sent oa=${oa.id} hwid=${hwid} trigger=${trigger.id} userId=${(lineUserId ?? "-").slice(0, 8)} via=${event.replyToken ? "reply" : "push"}`);
  return { status: "sent", triggerId: trigger.id };
}
