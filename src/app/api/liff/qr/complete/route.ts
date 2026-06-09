// src/app/api/liff/qr/complete/route.ts
// POST /api/liff/qr/complete — LIFF 内 QR 読み取り成功後のサーバー処理（プレイヤー向け・認証不要）
//
// 役割:
//   1. accessToken をサーバー検証して verified lineUserId を得る（フロントの userId は信用しない）
//   2. OA / Work / QR 機能の有効性・プランを検証する
//   3. QR 値を oaId/work scope 内の正規 Location として解決する（任意 URL/値を信用しない）
//   4. その Location に設定された「QR 成功メッセージ」を既存 LINE 送信ロジックで push する
//   5. 二重送信を抑止し、計測イベントを記録する
//
// セキュリティ方針:
//   - client から来た userId/displayName は使わない。push 先は verified lineUserId のみ。
//   - QR 値から messageId 等を直接受け取らない。送信メッセージは DB（Location.qrSuccessMessageId）由来。
//   - 他 OA / 他 work の Location は解決しない（workScope + oaId 一致を必須にする）。
//   - secret（accessToken / channelAccessToken）はログに出さない。QR 値は preview のみ記録。

import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { NextResponse } from "next/server";
import { verifyLiffAccessToken } from "@/lib/liff/session";
import { requirePlanFeature } from "@/lib/plan-guard";
import { FEATURE } from "@/lib/constants/plans";
import { parseQrValue, qrValuePreview } from "@/lib/liff/qr-resolve";
import { findLocationByIdOrPublicId } from "@/lib/public-id-resolver";
import { pushToLine, buildKeywordMessages, type KeywordMessageRecord, type PlaceholderVars } from "@/lib/line";
import type { LiffEventType } from "@/lib/liff-events";

export const dynamic = "force-dynamic";

/** QR 値の最大長（これを超える値は受け付けない）。 */
const MAX_QR_LEN = 2048;
/** 二重送信抑止の時間窓（同一 work × user × target の連続成功/開始をこの範囲で重複扱い）。 */
const DEDUPE_WINDOW_MS = 10_000;
/** メッセージチェーンの最大件数（LINE 返信上限と同じ 5 件）。 */
const MAX_CHAIN = 5;

const bodySchema = z.object({
  // accessToken 未指定/空も検証ステップで 401（missing_access_token）に倒すため optional にする。
  accessToken: z.string().max(4096).optional(),
  oaId:        z.string().min(1, "oaId は必須です"),
  workId:      z.string().min(1, "workId は必須です"),
  pageId:      z.string().max(200).optional(),
  locationId:  z.string().max(200).optional(),
  qrValue:     z.string().min(1, "qrValue は必須です").max(MAX_QR_LEN, "QR 値が長すぎます"),
  scanId:      z.string().max(100).optional(),
  mode:        z.string().max(40).optional(),
});

/** 計測イベントを fire-and-forget で保存（失敗してもユーザー体験は止めない）。
 *  lineUserId は verified のときのみ渡す。metadata に secret / 生 QR 値長文を入れない。 */
function logEvent(data: {
  workId:     string;
  lineUserId: string | null;
  eventType:  LiffEventType;
  metadata?:  Record<string, unknown>;
}): void {
  prisma.liffEventLog
    .create({
      data: {
        workId:       data.workId,
        lineUserId:   data.lineUserId,
        eventType:    data.eventType,
        metadataJson: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    })
    .catch((e) => console.error("[liff/qr/complete] event log failed:", e));
}

/** 直近 DEDUPE_WINDOW_MS 内に同一 target への送信開始/成功があれば重複とみなす（best-effort）。 */
async function isDuplicateSend(workId: string, lineUserId: string | null, targetId: string): Promise<boolean> {
  if (!lineUserId) return false;
  const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const rows = await prisma.liffEventLog.findMany({
    where: {
      workId,
      lineUserId,
      eventType: { in: ["qr_message_send_success", "qr_message_send_started"] },
      createdAt: { gte: cutoff },
    },
    select: { metadataJson: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return rows.some((r) => {
    const m = r.metadataJson as { targetId?: string } | null;
    return !!m && m.targetId === targetId;
  });
}

const MESSAGE_SELECT = {
  id: true, messageType: true, body: true, assetUrl: true, altText: true,
  flexPayloadJson: true, quickReplies: true, nextMessageId: true, sortOrder: true,
  imageActionType: true, imageActionText: true, imageActionUrl: true,
  imageActionLiffPageId: true, imageActionPostbackData: true,
  lagMs: true, freeInputEnabled: true,
  character: { select: { name: true, iconImageUrl: true } },
} as const;

/** 指定メッセージ + nextMessageId チェーン（最大 5 件・循環防止）を KeywordMessageRecord[] に変換する。
 *  webhook の buildMessageChain と同じ chain walk セマンティクスを踏襲する。 */
async function loadMessageChain(messageId: string): Promise<KeywordMessageRecord[]> {
  const head = await prisma.message.findUnique({ where: { id: messageId, isActive: true }, select: MESSAGE_SELECT });
  if (!head) return [];

  const records: Array<typeof head> = [head];
  const visited = new Set<string>([head.id]);
  let current = head;
  // freeInputEnabled の message はそこで停止する（応答は free_input_next_message_id 経由のため）。
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
    id:              r.id,
    messageType:     r.messageType,
    body:            r.body,
    assetUrl:        r.assetUrl,
    altText:         r.altText,
    flexPayloadJson: r.flexPayloadJson,
    quickReplies:    r.quickReplies,
    nextMessageId:   r.nextMessageId,
    sortOrder:       r.sortOrder,
    imageActionType:         r.imageActionType,
    imageActionText:         r.imageActionText,
    imageActionUrl:          r.imageActionUrl,
    imageActionLiffPageId:   r.imageActionLiffPageId,
    imageActionPostbackData: r.imageActionPostbackData,
    lagMs:           r.lagMs,
    freeInputEnabled: r.freeInputEnabled,
    character:       r.character,
  }));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 入力検証 ──
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です");
    return badRequest("リクエストボディが不正です");
  }
  const { accessToken, oaId, workId, qrValue, scanId, mode } = body;
  const preview = qrValuePreview(qrValue);

  try {
    // ── accessToken のサーバー検証（フロントの userId は信用しない）──
    const verify = await verifyLiffAccessToken(accessToken);
    if (!verify.ok) {
      console.warn(`[liff/qr/complete] token verify failed reason=${verify.reason}`);
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "LINE連携に失敗しました。もう一度開き直してください。" } },
        { status: 401 },
      );
    }
    const lineUserId = verify.lineUserId;
    const displayName = verify.displayName;

    // ── OA 検証 ──
    const oa = await prisma.oa.findUnique({
      where: { id: oaId },
      select: { id: true, title: true, channelAccessToken: true, liffScanQrEnabled: true, serviceSuspendedAt: true },
    });
    if (!oa) return notFound("OA");

    // QR 機能 OFF → feature disabled（403）
    if (!oa.liffScanQrEnabled) {
      return NextResponse.json(
        { success: false, error: { code: "FEATURE_DISABLED", message: "この作品では QR 読み取りが有効になっていません" } },
        { status: 403 },
      );
    }

    // プラン判定（QR/ロケーションは location feature）。platform admin preview は本番判定に影響しない。
    const guard = await requirePlanFeature({ oaId: oa.id, featureKey: FEATURE.location });
    if (!guard.ok) return guard.response;

    // ── Work が OA に属することを検証 ──
    const work = await prisma.work.findUnique({ where: { id: workId }, select: { id: true, oaId: true } });
    if (!work || work.oaId !== oa.id) return notFound("作品");

    // OA 停止中は push しない（既存 webhook の停止仕様に合わせ、送信は行わない）。
    if (oa.serviceSuspendedAt) {
      logEvent({ workId, lineUserId, eventType: "qr_message_send_skipped", metadata: { reason: "service_suspended", qrPreview: preview, isLineUserVerified: true } });
      return ok({ ok: true, sent: false, alreadyProcessed: false, code: "service_suspended", message: "現在このアカウントのサービスは利用できません。" });
    }

    // ── QR 値の解決（oaId/work scope 内の正規 Location のみ）──
    logEvent({ workId, lineUserId, eventType: "qr_scan_success", metadata: { qrPreview: preview, mode: mode ?? null, isLineUserVerified: true } });

    const parsed = parseQrValue(qrValue);
    const locationRef = body.locationId || parsed.locationRef;
    const location = locationRef
      ? await findLocationByIdOrPublicId(locationRef, { workScope: work.id })
      : null;

    if (!location) {
      logEvent({ workId, lineUserId, eventType: "qr_message_send_skipped", metadata: { reason: "qr_not_matched", qrPreview: preview, isLineUserVerified: true } });
      return ok({ ok: false, sent: false, code: "qr_not_matched", message: "このQRコードはこの作品では使えません。" });
    }

    const target = { type: "location" as const, id: location.id, name: location.name };

    // ── 送信メッセージの決定（DB 設定のみ。未設定ならハードコードしない）──
    if (!location.qrSuccessMessageId) {
      logEvent({ workId, lineUserId, eventType: "qr_message_send_skipped", metadata: { reason: "message_not_configured", targetType: "location", targetId: location.id, isLineUserVerified: true } });
      return ok({ ok: true, sent: false, code: "message_not_configured", message: "QRは読み取りましたが、送信するメッセージが設定されていません。", target });
    }

    // ── 二重送信抑止 ──
    if (await isDuplicateSend(workId, lineUserId, location.id)) {
      logEvent({ workId, lineUserId, eventType: "qr_message_duplicate", metadata: { targetType: "location", targetId: location.id, scanId: scanId ?? null, isLineUserVerified: true } });
      return ok({ ok: true, sent: false, alreadyProcessed: true, code: "already_processed", message: "このQRはすでに読み取り済みです。", target });
    }

    // ── メッセージ構築（既存 builder を再利用）──
    const records = await loadMessageChain(location.qrSuccessMessageId);
    if (records.length === 0) {
      logEvent({ workId, lineUserId, eventType: "qr_message_send_skipped", metadata: { reason: "message_not_configured", targetType: "location", targetId: location.id, isLineUserVerified: true } });
      return ok({ ok: true, sent: false, code: "message_not_configured", message: "QRは読み取りましたが、送信するメッセージが設定されていません。", target });
    }

    const vars: PlaceholderVars = { userName: displayName ?? undefined, accountName: oa.title };
    const messages = buildKeywordMessages(records, undefined, vars);

    // 送信開始を記録（idempotency 窓に入れる）→ push → 結果記録。
    logEvent({ workId, lineUserId, eventType: "qr_message_send_started", metadata: { targetType: "location", targetId: location.id, messageId: location.qrSuccessMessageId, scanId: scanId ?? null, isLineUserVerified: true } });

    const result = await pushToLine(lineUserId, messages, oa.channelAccessToken);
    if (!result.ok) {
      logEvent({ workId, lineUserId, eventType: "qr_message_send_failed", metadata: { targetType: "location", targetId: location.id, messageId: location.qrSuccessMessageId, status: result.status ?? null, isLineUserVerified: true } });
      return NextResponse.json(
        { success: false, error: { code: "SEND_FAILED", message: "メッセージ送信に失敗しました。もう一度お試しください。" } },
        { status: 502 },
      );
    }

    logEvent({ workId, lineUserId, eventType: "qr_message_send_success", metadata: { targetType: "location", targetId: location.id, messageId: location.qrSuccessMessageId, count: messages.length, isLineUserVerified: true } });

    return ok({
      ok:               true,
      sent:             true,
      alreadyProcessed: false,
      target,
      message:          { id: location.qrSuccessMessageId, count: messages.length },
    });
  } catch (err) {
    return serverError(err);
  }
}
