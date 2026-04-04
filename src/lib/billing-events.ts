// src/lib/billing-events.ts
// 課金導線イベントの詳細ログ記録（BillingEventLog テーブル）
//
// 設計:
//   - BillingEventLog は重複許容。同一ユーザーが複数回クリックしても全件残す
//   - 失敗しても本処理を止めない。console.error のみ残す
//   - サーバーサイド専用（API ルート・サーバーコンポーネントから呼ぶ）
//   - クライアントサイドからは /api/billing-events 経由（billing-tracker.ts）を使う
//
// 使い方:
//   trackBillingEventLog({ userId: user.id, oaId, event: "pricing_view" });
//   // await しない — エラーはサイレントに処理される

import { prisma } from "@/lib/prisma";
import type { BillingEvent } from "@/lib/constants/billing-events";

/**
 * 課金導線イベントを BillingEventLog テーブルに記録する。
 *
 * - 全フィールドが nullable のため、コンテキストが揃っていなくても呼べる
 * - 失敗しても例外を投げない（console.error のみ）
 * - 呼び出し側は通常 await しない（fire-and-forget）
 *
 * @example
 * // fire-and-forget
 * trackBillingEventLog({ userId: user.id, oaId, event: "pricing_view" });
 * return ok(data);
 *
 * @example
 * // source 付き（流入元を記録したい場合）
 * trackBillingEventLog({ userId: user.id, event: "pricing_click_from_header", source: "header" });
 */
export async function trackBillingEventLog({
  userId,
  oaId,
  workId,
  event,
  source,
}: {
  userId?:  string | null;
  oaId?:   string | null;
  workId?:  string | null;
  event:    BillingEvent;
  source?:  string | null;
}): Promise<void> {
  try {
    await prisma.billingEventLog.create({
      data: {
        userId:  userId  ?? null,
        oaId:    oaId    ?? null,
        workId:  workId  ?? null,
        event,
        source:  source  ?? null,
      },
    });
  } catch (err) {
    console.error("[trackBillingEventLog] failed to record event:", event, err);
  }
}
