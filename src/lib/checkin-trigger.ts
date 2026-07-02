// src/lib/checkin-trigger.ts
//
// 送信後の待機トリガー（地点到着で自動進行）の arm / consume。
//
// 体験:
//   1. Message.checkinTrigger* を設定したメッセージA が送信される
//      → そのユーザー向けに CheckinWaitTrigger を pending で作成（arm）。
//   2. ユーザーが対象地点B で QR / GPS チェックインに成功する
//      → pending がある場合のみ next メッセージ（メッセージB）を push し、任意で next フェーズへ進める（consume）。
//      → consumed 化して二重送信を防止（atomic claim）。
//   3. pending が無い検知（= まだメッセージA に到達していないユーザー）は何も送信しない。
//
// 設計:
//   - arm は applyFreeInputPostEffect（全送信の集中フック）から呼ぶ。
//   - consume は /api/liff/qr/complete（QR）と /api/liff/checkin（QR/GPS）から呼ぶ。
//     同一チェックインが両経路を通っても atomic claim で送信は1回だけ。
//   - 失敗（DB/送信）は握りつぶしてチェックイン本体の結果を壊さない。
//   - beacon の検知側 consume は次PRで実装（triggerType に "beacon" を持てる設計は本PRで完了済み）。

import { prisma } from "@/lib/prisma";
import { activeCache, CACHE_KEY } from "@/lib/cache";
import { pushToLine, buildKeywordMessages, type KeywordMessageRecord, type PlaceholderVars } from "@/lib/line";

/** next メッセージ送信時のチェーン最大件数（LINE 返信上限と同じ 5 件）。 */
const MAX_CHAIN = 5;

const MESSAGE_SELECT = {
  id: true, messageType: true, body: true, assetUrl: true, altText: true,
  assetPreviewUrl: true, assetUsage: true,
  flexPayloadJson: true, quickReplies: true, nextMessageId: true, sortOrder: true,
  imageActionType: true, imageActionText: true, imageActionUrl: true,
  imageActionLiffPageId: true, imageActionPostbackData: true,
  lagMs: true, freeInputEnabled: true,
  character: { select: { name: true, iconImageUrl: true } },
} as const;

/** 指定メッセージ + nextMessageId チェーン（最大 5 件・循環防止）を KeywordMessageRecord[] に変換する。
 *  qr/complete・webhook の chain walk と同じセマンティクス。 */
async function loadMessageChain(messageId: string): Promise<KeywordMessageRecord[]> {
  const head = await prisma.message.findUnique({ where: { id: messageId, isActive: true }, select: MESSAGE_SELECT });
  if (!head) return [];

  const records: Array<typeof head> = [head];
  const visited = new Set<string>([head.id]);
  let current = head;
  while (records.length < MAX_CHAIN && current.nextMessageId && !current.freeInputEnabled) {
    if (visited.has(current.nextMessageId)) break;
    const next = await prisma.message.findUnique({
      where: { id: current.nextMessageId, isActive: true }, select: MESSAGE_SELECT,
    });
    if (!next) break;
    visited.add(next.id);
    records.push(next);
    if (next.freeInputEnabled) break;
    current = next;
  }

  return records.map((r) => ({
    id: r.id, messageType: r.messageType, body: r.body, assetUrl: r.assetUrl, altText: r.altText,
    flexPayloadJson: r.flexPayloadJson, quickReplies: r.quickReplies, nextMessageId: r.nextMessageId,
    sortOrder: r.sortOrder,
    imageActionType: r.imageActionType, imageActionText: r.imageActionText, imageActionUrl: r.imageActionUrl,
    imageActionLiffPageId: r.imageActionLiffPageId, imageActionPostbackData: r.imageActionPostbackData,
    lagMs: r.lagMs, freeInputEnabled: r.freeInputEnabled, character: r.character,
  }));
}

/** arm 用の冪等キー。同一ユーザー×地点×source×種別の再送は1行を再 arm する。 */
function buildIdempotencyKey(lineUserId: string, locationId: string, sourceMessageId: string | null, triggerType: string): string {
  return `${lineUserId}:${locationId}:${sourceMessageId ?? "_"}:${triggerType}`;
}

/**
 * 送信されたメッセージ群のうち checkinTrigger* を持つものについて、
 * 対象ユーザーを「対象地点の検知待ち（pending）」に arm する。
 * 既存 pending は upsert で再 arm（status=pending / armedAt 更新 / consumedAt クリア）。
 *
 * 失敗は握りつぶす（送信本体を壊さない）。
 */
export async function armCheckinTriggers(args: {
  sentMessageIds: string[];
  lineUserId:     string;
  workId:         string;
  oaId?:          string;
  /** ログ用の発生源ラベル。"send"=通常送信(applyFreeInputPostEffect) / "arrival-message"=地点到着で送信した次メッセージ（チェーン）。 */
  source?:        string;
}): Promise<void> {
  if (args.sentMessageIds.length === 0) return;
  const source = args.source ?? "send";
  try {
    const msgs = await prisma.message.findMany({
      where: {
        id: { in: args.sentMessageIds },
        isActive: true,
        checkinTriggerType: { not: null },
        checkinTriggerLocationId: { not: null },
      },
      select: {
        id: true, phaseId: true,
        checkinTriggerType: true, checkinTriggerLocationId: true,
        checkinTriggerNextMessageId: true, checkinTriggerNextPhaseId: true,
      },
    });
    if (msgs.length === 0) return;

    // oaId が渡されない経路（webhook 以外）でも arm できるよう work から解決。
    let oaId = args.oaId ?? null;
    if (!oaId) {
      const work = await prisma.work.findUnique({ where: { id: args.workId }, select: { oaId: true } });
      oaId = work?.oaId ?? null;
    }
    if (!oaId) {
      console.warn("[checkin-trigger:arm] oaId 解決失敗 workId=", args.workId);
      return;
    }

    for (const m of msgs) {
      const triggerType = m.checkinTriggerType as string;
      const locationId = m.checkinTriggerLocationId as string;
      const key = buildIdempotencyKey(args.lineUserId, locationId, m.id, triggerType);
      await prisma.checkinWaitTrigger.upsert({
        where: { idempotencyKey: key },
        create: {
          oaId, workId: args.workId, lineUserId: args.lineUserId,
          sourceMessageId: m.id, phaseId: m.phaseId,
          locationId, triggerType,
          nextMessageId: m.checkinTriggerNextMessageId, nextPhaseId: m.checkinTriggerNextPhaseId,
          status: "pending", idempotencyKey: key,
        },
        update: {
          status: "pending", armedAt: new Date(), consumedAt: null,
          locationId, triggerType,
          nextMessageId: m.checkinTriggerNextMessageId, nextPhaseId: m.checkinTriggerNextPhaseId,
        },
      });
      console.info("[checkin-trigger:arm]", JSON.stringify({
        workId: args.workId, userIdPrefix: args.lineUserId.slice(0, 8),
        locationId, triggerType, sourceMessageId: m.id, source,
      }));
    }
  } catch (err) {
    console.error("[checkin-trigger:arm] 失敗", err);
  }
}

export interface ConsumeResult {
  /** pending を消化して何らかのアクション（送信 or 遷移）を実行したか */
  consumed: boolean;
  /** 送信した next メッセージ件数 */
  sentCount: number;
  /** 遷移した先のフェーズ ID（あれば） */
  transitionedTo: string | null;
}

/**
 * 対象地点の検知成功時に、その(ユーザー×地点×種別)の pending トリガーを消化する。
 * pending が無ければ何もしない（= 未到達ユーザーへ送信しない）。
 *
 * 二重送信防止: atomic な updateMany(status: pending → consumed) で claim した1件のみ送信する。
 * 同一チェックインが /qr/complete と /checkin の両方から呼んでも送信は1回だけ。
 *
 * 失敗は握りつぶしてチェックイン本体の結果を壊さない。
 */
export async function consumeCheckinTrigger(opts: {
  lineUserId:   string;
  workId:       string;
  locationId:   string;
  /** このチェックイン方式で消化を許可する triggerType（例: ["qr"] / ["gps"] / ["qr","gps"]） */
  triggerTypes: string[];
}): Promise<ConsumeResult> {
  const none: ConsumeResult = { consumed: false, sentCount: 0, transitionedTo: null };
  try {
    const now = new Date();
    // 最新の pending を1件特定（期限切れは除外）。
    const trig = await prisma.checkinWaitTrigger.findFirst({
      where: {
        lineUserId: opts.lineUserId,
        workId:     opts.workId,
        locationId: opts.locationId,
        triggerType: { in: opts.triggerTypes },
        status:     "pending",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { armedAt: "desc" },
    });
    if (!trig) {
      console.info("[checkin-trigger:consume:miss]", JSON.stringify({
        workId: opts.workId, userIdPrefix: opts.lineUserId.slice(0, 8),
        locationId: opts.locationId, triggerTypes: opts.triggerTypes,
      }));
      return none;
    }

    // atomic claim（同時実行・両経路での二重送信を防ぐ）。
    const claim = await prisma.checkinWaitTrigger.updateMany({
      where: { id: trig.id, status: "pending" },
      data:  { status: "consumed", consumedAt: now },
    });
    if (claim.count !== 1) return none; // 既に他経路/並行リクエストが消化済み

    let sentCount = 0;
    let transitionedTo: string | null = null;

    // ── 1. next メッセージ送信（任意）──
    if (trig.nextMessageId) {
      const oa = await prisma.oa.findUnique({
        where: { id: trig.oaId },
        select: { channelAccessToken: true, title: true, serviceSuspendedAt: true },
      });
      if (oa && !oa.serviceSuspendedAt && oa.channelAccessToken) {
        const records = await loadMessageChain(trig.nextMessageId);
        if (records.length > 0) {
          const vars: PlaceholderVars = { accountName: oa.title };
          const messages = buildKeywordMessages(records, undefined, vars);
          const res = await pushToLine(trig.lineUserId, messages, oa.channelAccessToken);
          if (res.ok) {
            sentCount = messages.length;
            // ── チェーン arm ──
            // 到着で送信した next メッセージ自身に checkin_trigger があれば、次地点を arm する
            // （通常送信の post effect と同じ armCheckinTriggers を再利用）。
            // ここでは pending を1段 作成するだけ＝即時 consume はしない（実到着が必要）ため再帰暴走しない。
            // 二重 arm は idempotencyKey の upsert で防止。consumed 済みは上の atomic claim で弾かれ本処理に来ない。
            await armCheckinTriggers({
              sentMessageIds: records.map((r) => r.id),
              lineUserId:     trig.lineUserId,
              workId:         opts.workId,
              oaId:           trig.oaId,
              source:         "arrival-message",
            });
          } else {
            console.error("[checkin-trigger:consume] push 失敗 status=", res.status ?? null);
          }
        }
      }
    }

    // ── 2. フェーズ遷移（任意）──
    if (trig.nextPhaseId) {
      const phase = await prisma.phase.findUnique({
        where: { id: trig.nextPhaseId },
        select: { id: true, phaseType: true },
      });
      if (phase) {
        await prisma.userProgress.update({
          where: { lineUserId_workId: { lineUserId: opts.lineUserId, workId: opts.workId } },
          data: {
            currentPhaseId: phase.id,
            lastInteractedAt: now,
            ...(phase.phaseType === "ending" ? { reachedEnding: true } : {}),
          },
        }).then(() => activeCache.delete(CACHE_KEY.progress(opts.lineUserId, opts.workId)))
          .catch((e) => console.error("[checkin-trigger:consume] phase 遷移失敗", e));
        transitionedTo = phase.id;
      }
    }

    console.info("[checkin-trigger:consume:hit]", JSON.stringify({
      workId: opts.workId, userIdPrefix: opts.lineUserId.slice(0, 8),
      locationId: opts.locationId, triggerType: trig.triggerType,
      sentCount, transitionedTo,
    }));
    return { consumed: true, sentCount, transitionedTo };
  } catch (err) {
    console.error("[checkin-trigger:consume] 失敗", err);
    return none;
  }
}

/**
 * Beacon 検知時の「送信後の待機トリガー」消化。
 * beacon → BeaconTrigger.locationId で解決した locationId をもとに、その地点の workId を Location から解決し、
 * QR/GPS と同じ consumeCheckinTrigger（triggerType=beacon）に委譲する（共通化）。
 *
 * pending が無ければ送信しない（未到達ユーザーへの誤送信防止）。二重送信防止は atomic claim で担保。
 * 失敗は握りつぶして beacon 処理本体を壊さない。
 */
export async function consumeBeaconArrivalTrigger(opts: {
  lineUserId: string;
  locationId: string;
}): Promise<ConsumeResult> {
  const none: ConsumeResult = { consumed: false, sentCount: 0, transitionedTo: null };
  try {
    const loc = await prisma.location.findUnique({
      where: { id: opts.locationId },
      select: { workId: true },
    });
    if (!loc) {
      console.info("[checkin-trigger:beacon:no-location]", JSON.stringify({
        userIdPrefix: opts.lineUserId.slice(0, 8), locationId: opts.locationId,
      }));
      return none;
    }
    return await consumeCheckinTrigger({
      lineUserId:   opts.lineUserId,
      workId:       loc.workId,
      locationId:   opts.locationId,
      triggerTypes: ["beacon"],
    });
  } catch (err) {
    console.error("[checkin-trigger:beacon] 失敗", err);
    return none;
  }
}
