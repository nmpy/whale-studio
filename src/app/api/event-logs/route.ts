// src/app/api/event-logs/route.ts
// POST /api/event-logs — 汎用行動ログ記録エンドポイント
//
// ブラウザから fire-and-forget で呼ばれることを想定。
// 未認証でも記録は成功させる（userId が null になるだけ）。
//
// リクエストボディ:
//   event_name : string           — イベント名（EVENT_NAMES 定数に一致すること）
//   payload    : Record<string,*> — イベント固有の補足情報（任意フィールド）
//   oa_id      : string | null    — OA コンテキスト（任意）
//
// レスポンス:
//   201 { ok: true }
//   400 バリデーション失敗
//   500 サーバーエラー

import { withAuth }                            from "@/lib/auth";
import { created, serverError, badRequest }    from "@/lib/api-response";
import { logEvent }                            from "@/lib/event-logger";
import { EVENT_NAMES }                         from "@/lib/constants/event-names";
import type { EventName, EventPayloadMap }     from "@/lib/constants/event-names";
import { z }                                   from "zod";

const schema = z.object({
  event_name: z.enum(EVENT_NAMES),
  payload:    z.record(z.unknown()).default({}),
  oa_id:      z.string().nullable().optional(),
});

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body   = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest("event_name が不正です");

    const { event_name, payload, oa_id } = parsed.data;

    // fire-and-forget（await しない）
    // サーバー側では payload の型チェックをランタイムで行わず、
    // unknown 経由でキャストして型の整合性をクライアント側に委ねる
    logEvent(
      event_name as EventName,
      payload    as unknown as EventPayloadMap[EventName],
      {
        userId: user.id ?? null,
        oaId:   oa_id  ?? null,
      },
    );

    return created({ ok: true });
  } catch (err) {
    return serverError(err);
  }
});
