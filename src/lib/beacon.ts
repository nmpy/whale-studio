// src/lib/beacon.ts
//
// LINE Beacon webhook イベントの処理ロジック。
//
// 設計方針:
//  - webhook ルートから呼び出すが、テスト容易性のため
//    Prisma / LINE 送信は依存注入（または引数）として受け取る。
//  - 必ず BeaconEventLog を作成して結果を残す（重複排除・障害解析に利用）。
//  - 1 イベントの失敗で webhook 全体を 500 にしないこと。
//  - 管理画面の「疑似発火テスト」も本処理（同じ resolver / sender）を通す（isTest=true）。

import type { PrismaClient } from "@prisma/client";
import { normalizeBeaconHwid, InvalidBeaconHwidError } from "@/lib/beacon-hwid";
import type { LineMessage } from "@/lib/line";
import { resolveDestinationUrl } from "@/lib/destination-url-builder";
import { getLiffIdForUrlGeneration } from "@/lib/liff/config";

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
  /**
   * この OA の LIFF アプリ ID（Oa.liffId）。destination(liff) の URL 生成に使う。
   * env の共通 LIFF へフォールバックしない（別 OA の LIFF URL を送らないため）。
   * 未設定なら liff 型 destination は URL 生成不能として送信をスキップする。
   */
  liffId?: string | null;
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
  oa: Pick<BeaconOaContext, "liffId">,
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
      // liff 型の URL は**この OA の Oa.liffId** で組む（env の共通 LIFF は使わない）。
      // destination は必ずこの OA 配下の Work に属するので、oa.liffId が正しい正本。
      // 解決できなければ resolveDestinationUrl が null を返し、下の !url で送信しない。
      const url = resolveDestinationUrl({
        destinationType: dest.destinationType,
        liffTargetType:  dest.liffTargetType,
        urlOrPath:       dest.urlOrPath,
        queryParamsJson: dest.queryParamsJson as Record<string, string>,
        workId:          dest.workId,
      }, { liffId: getLiffIdForUrlGeneration(oa) });
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

/** action_type="message" のとき送信対象 messageId を取り出す（ログ記録用）。それ以外は null。 */
function extractMessageId(actionType: string, actionPayload: unknown): string | null {
  if (actionType !== "message") return null;
  const payload = (actionPayload ?? {}) as Record<string, unknown>;
  return typeof payload.message_id === "string" && payload.message_id.trim()
    ? payload.message_id.trim()
    : null;
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
  /** 疑似発火テスト由来か（ログに isTest=true を残す）。 */
  isTest?: boolean;
  /**
   * テスト発火時に cooldown / oncePerUser / maxTriggersPerUser の各制限を無視するか。
   * platform admin の「制限を無視して送信」用。default false（= 本番同様に制限を適用）。
   */
  ignoreLimits?: boolean;
  /** 現在時刻（テスト用に注入可） */
  now?: () => Date;
  /**
   * 「送信後の待機トリガー(地点到着で自動進行)」の消化フック。
   * 有効な beacon 検知（enabled / 未停止 / プラン可 / eventType 一致 / 有効期間内）で、かつ
   * BeaconTrigger.locationId が設定されている場合に1回だけ呼ばれる。
   * 本番 webhook 経路でのみ注入する（test-fire では渡さない＝実ユーザーの pending を消化しない）。
   * 既存 BeaconTrigger アクションとは独立し、cooldown / oncePerUser の影響を受けない。
   * 内部で例外を握りつぶすこと（beacon 本処理を壊さない）。
   */
  onArrivalDetected?: (ctx: { lineUserId: string; locationId: string }) => Promise<void>;
}): Promise<HandleBeaconResult> {
  const { prisma, oa, event, line, resolveMessage } = args;
  const isTest = args.isTest ?? false;
  const ignoreLimits = args.ignoreLimits ?? false;
  const now = args.now ?? (() => new Date());

  console.log(
    `[LINE Beacon] received oa=${oa.id} hwid="${event.beacon?.hwid ?? ""}" type=${event.beacon?.type ?? "-"} userId=${(event.source?.userId ?? "-").slice(0, 8)}${isTest ? " (test)" : ""}`,
  );

  const lineUserId = event.source?.userId ?? null;
  const beaconType = event.beacon?.type ?? "";
  const deviceMessage = event.beacon?.dm ?? null;
  const isRedelivery = !!event.deliveryContext?.isRedelivery;
  const webhookEventId = event.webhookEventId
    ?? `synthetic:${oa.id}:${event.timestamp}:${event.beacon?.hwid ?? "unknown"}:${lineUserId ?? "anon"}`;

  // 全ログ書き込みで共通するフィールドを 1 箇所に集約（isTest / rawEvent / webhookEventId 等の付け忘れ防止）。
  const writeLog = (extra: {
    actionStatus:    string;
    hwid:            string;
    workId?:         string | null;
    beaconTriggerId?: string | null;
    errorMessage?:   string | null;
    messageId?:      string | null;
  }) =>
    prisma.beaconEventLog.create({
      data: {
        oaId:            oa.id,
        workId:          extra.workId ?? null,
        beaconTriggerId: extra.beaconTriggerId ?? null,
        lineUserId,
        hwid:            extra.hwid,
        beaconType,
        deviceMessage,
        webhookEventId,
        isRedelivery,
        actionStatus:    extra.actionStatus,
        errorMessage:    extra.errorMessage ?? null,
        messageId:       extra.messageId ?? null,
        isTest,
        rawEvent:        event as unknown as object,
      },
    });

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
    await writeLog({
      actionStatus: "ignored",
      hwid: String(event.beacon?.hwid ?? ""),
      errorMessage: msg,
    });
    return { status: "ignored", reason: msg };
  }

  // ── 3. trigger 検索 ──
  const trigger = await prisma.beaconTrigger.findUnique({
    where: { oaId_hwid: { oaId: oa.id, hwid } },
  });

  if (!trigger) {
    console.log(`[LINE Beacon] unknown_beacon oa=${oa.id} hwid="${hwid}" userId=${(lineUserId ?? "-").slice(0, 8)}`);
    await writeLog({ actionStatus: "unknown_beacon", hwid, errorMessage: "no matching trigger" });
    return { status: "ignored", reason: "no matching trigger" };
  }

  const trig = trigger; // 以降は確定（非 null）
  const baseLog = { hwid, workId: trig.workId, beaconTriggerId: trig.id };
  const sentMessageId = extractMessageId(trig.actionType, trig.actionPayload);

  // ── 4. enabled チェック ──
  if (!trig.enabled) {
    await writeLog({ ...baseLog, actionStatus: "ignored", errorMessage: "trigger disabled" });
    return { status: "ignored", reason: "trigger disabled", triggerId: trig.id };
  }

  // ── 4.5. OA サービス停止中 → 送信しない（既存のサービス停止仕様に従う）──
  if (oa.serviceSuspendedAt) {
    console.log(`[LINE Beacon] service_stopped oa=${oa.id} hwid=${hwid} trigger=${trig.id}`);
    await writeLog({ ...baseLog, actionStatus: "service_stopped", errorMessage: "OA service suspended" });
    return { status: "ignored", reason: "service_stopped", triggerId: trig.id };
  }

  // ── 4.6. プラン gate（Beacon 連動は Pro 相当 / FEATURE.location）──
  if (oa.planAllowed === false) {
    console.log(`[LINE Beacon] plan_blocked oa=${oa.id} hwid=${hwid} trigger=${trig.id}`);
    await writeLog({ ...baseLog, actionStatus: "plan_blocked", errorMessage: "plan does not allow beacon" });
    return { status: "ignored", reason: "plan_blocked", triggerId: trig.id };
  }

  // ── 5. eventTypes フィルタ（MVP: enter のみ想定）──
  const allowed = trig.eventTypes.split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(beaconType)) {
    await writeLog({
      ...baseLog,
      actionStatus: "ignored",
      errorMessage: `beaconType "${beaconType}" not in [${allowed.join(",")}]`,
    });
    return { status: "ignored", reason: "beacon type not allowed", triggerId: trig.id };
  }

  // ── 5.5. 有効期間チェック（validFrom / validTo）──
  const nowDate = now();
  if ((trig.validFrom && nowDate < trig.validFrom) || (trig.validTo && nowDate > trig.validTo)) {
    console.log(`[LINE Beacon] skipped_invalid_period oa=${oa.id} hwid=${hwid} trigger=${trig.id}`);
    await writeLog({
      ...baseLog,
      actionStatus: "skipped_invalid_period",
      errorMessage: `outside valid period [${trig.validFrom?.toISOString() ?? "-"} .. ${trig.validTo?.toISOString() ?? "-"}]`,
    });
    return { status: "ignored", reason: "outside valid period", triggerId: trig.id };
  }

  // ── 5.55. 送信後の待機トリガー(地点到着で自動進行)の消化 ──
  // ここまで到達 = 有効な beacon 検知（enabled / 未停止 / プラン可 / eventType 一致 / 有効期間内）。
  // BeaconTrigger.locationId が設定されていれば、その地点の pending を消化する（webhook 注入の callback 経由）。
  // 既存 BeaconTrigger アクションとは独立し、以降の cooldown / oncePerUser 判定の影響を受けない。
  // pending が無ければ送信されない（callback 内で gating）。二重送信は callback 内の atomic claim で防止。
  if (args.onArrivalDetected && lineUserId && trig.locationId) {
    try {
      await args.onArrivalDetected({ lineUserId, locationId: trig.locationId });
    } catch (e) {
      console.error(`[LINE Beacon] arrival trigger consume failed oa=${oa.id} hwid=${hwid} trigger=${trig.id}`, e);
    }
  }

  // ── 5.6. oncePerUser / maxTriggersPerUser（同 lineUserId × triggerId の成功ログ件数）──
  // ignoreLimits（テスト発火の「制限を無視」）のときはスキップ。
  if (lineUserId && !ignoreLimits && (trig.oncePerUser || trig.maxTriggersPerUser != null)) {
    const successCount = await prisma.beaconEventLog.count({
      where: {
        beaconTriggerId: trig.id,
        lineUserId,
        actionStatus: { in: ["sent", "matched"] },
      },
    });
    if (trig.oncePerUser && successCount >= 1) {
      console.log(`[LINE Beacon] skipped_once_per_user oa=${oa.id} hwid=${hwid} trigger=${trig.id} userId=${lineUserId.slice(0, 8)}`);
      await writeLog({ ...baseLog, actionStatus: "skipped_once_per_user", errorMessage: "once per user already fired" });
      return { status: "ignored", reason: "once per user", triggerId: trig.id };
    }
    if (trig.maxTriggersPerUser != null && successCount >= trig.maxTriggersPerUser) {
      console.log(`[LINE Beacon] skipped_max_per_user oa=${oa.id} hwid=${hwid} trigger=${trig.id} userId=${lineUserId.slice(0, 8)} count=${successCount}`);
      await writeLog({ ...baseLog, actionStatus: "skipped_max_per_user", errorMessage: `max ${trig.maxTriggersPerUser} reached (count=${successCount})` });
      return { status: "ignored", reason: "max triggers per user", triggerId: trig.id };
    }
  }

  // ── 6. cooldown チェック（同 lineUserId × triggerId の直近成功ログ）──
  if (lineUserId && !ignoreLimits && trig.cooldownSeconds > 0) {
    const cutoff = new Date(nowDate.getTime() - trig.cooldownSeconds * 1000);
    const recent = await prisma.beaconEventLog.findFirst({
      where: {
        beaconTriggerId: trig.id,
        lineUserId,
        actionStatus: { in: ["sent", "matched"] },
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    });
    if (recent) {
      console.log(`[LINE Beacon] suppressed_cooldown oa=${oa.id} hwid=${hwid} trigger=${trig.id} userId=${lineUserId.slice(0, 8)}`);
      await writeLog({ ...baseLog, actionStatus: "cooldown", errorMessage: `last sent at ${recent.createdAt.toISOString()}` });
      return { status: "cooldown", reason: "within cooldown window", triggerId: trig.id };
    }
  }

  // ── 7. アクション実行 ──
  let messages: LineMessage[] | null;
  try {
    messages = await buildActionMessages(prisma, oa, {
      actionType:    trig.actionType,
      actionPayload: trig.actionPayload,
      workId:        trig.workId,
    }, resolveMessage);
  } catch (e) {
    messages = null;
    console.warn("[beacon] buildActionMessages threw", e);
  }

  if (messages === null) {
    // action_type="message" で messageId 未設定/解決不能なら message_not_configured として扱う。
    const isMessageAction = trig.actionType === "message";
    const status = isMessageAction ? "message_not_configured" : "failed";
    const reason = isMessageAction ? "message not configured" : `invalid action config (type=${trig.actionType})`;
    console.log(`[LINE Beacon] ${status} oa=${oa.id} hwid=${hwid} trigger=${trig.id}`);
    await writeLog({ ...baseLog, actionStatus: status, errorMessage: reason, messageId: sentMessageId });
    return { status: isMessageAction ? "ignored" : "failed", reason, triggerId: trig.id };
  }

  // noop（ログ専用トリガー）の場合は matched で記録して終わり
  if (messages.length === 0) {
    await writeLog({ ...baseLog, actionStatus: "matched", messageId: sentMessageId });
    return { status: "matched", triggerId: trig.id };
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

  await writeLog({
    ...baseLog,
    actionStatus: sendError ? "failed" : "sent",
    errorMessage: sendError,
    messageId: sentMessageId,
  });

  if (sendError) {
    console.log(`[LINE Beacon] failed oa=${oa.id} hwid=${hwid} trigger=${trig.id} error="${sendError}"`);
    return { status: "failed", reason: sendError, triggerId: trig.id };
  }
  console.log(`[LINE Beacon] sent oa=${oa.id} hwid=${hwid} trigger=${trig.id} userId=${(lineUserId ?? "-").slice(0, 8)} via=${event.replyToken ? "reply" : "push"}`);
  return { status: "sent", triggerId: trig.id };
}
