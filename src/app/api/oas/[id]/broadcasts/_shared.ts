// src/app/api/oas/[id]/broadcasts/_shared.ts
//
// 配信メッセージ API の共有ヘルパー。**配信専用**（応答メッセージ API とは共有しない）。

import { z } from "zod";
import {
  BROADCAST_TEXT_MAX, BROADCAST_MEDIA_URL_MAX, BROADCAST_ALT_TEXT_MAX,
  isSendableImageUrl, isBroadcastFlexContainer,
} from "@/lib/broadcast/content";

/**
 * 権限方針:
 *   - 参照（一覧 / 履歴 / 詳細）: viewer 以上
 *   - 下書き作成・編集・対象人数確認・テスト送信: editor 以上
 *   - **本配信の開始 / 再送: admin 以上**
 *
 * 「応答メッセージを編集できる権限（editor）」と「本配信できる権限」を意図的に分ける。
 * 本配信は取り消せず LINE の月間通数を消費するため、安全側に倒して 1 段高い権限を要求する。
 */
export const BROADCAST_VIEW_ROLE = "viewer" as const;
export const BROADCAST_EDIT_ROLE = "editor" as const;
export const BROADCAST_SEND_ROLE = "admin" as const;

/** 宛先指定。クライアントから lineUserId を受け取る経路は用意しない（サーバー側でのみ解決する）。 */
export const broadcastTargetSchema = z.discriminatedUnion("target_type", [
  z.object({ target_type: z.literal("all") }),
  z.object({
    target_type: z.literal("segment"),
    segment_id:  z.string().uuid(),
    work_id:     z.string().uuid(),
  }),
]);

/**
 * 配信本文。kind による discriminated union。
 *
 * 既存の text 形式はそのまま維持する（Production の既存 draft / 履歴と互換）。
 * 画像 URL と Flex コンテナは、zod の形だけでなく content layer の検証関数
 * （isSendableImageUrl / isBroadcastFlexContainer）を通す。HTTPS 限定・URL 長・
 * bubble|carousel・サイズ上限といった LINE 仕様の判定を API 層に複製しないため。
 */
export const broadcastContentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1).max(BROADCAST_TEXT_MAX),
  }),
  z.object({
    kind: z.literal("image"),
    originalContentUrl: z.string().min(1).max(BROADCAST_MEDIA_URL_MAX)
      .refine(isSendableImageUrl, "画像 URL は https:// で始まる必要があります"),
    previewImageUrl: z.string().min(1).max(BROADCAST_MEDIA_URL_MAX)
      .refine(isSendableImageUrl, "プレビュー画像 URL は https:// で始まる必要があります"),
  }),
  z.object({
    kind: z.literal("flex"),
    altText: z.string().min(1).max(BROADCAST_ALT_TEXT_MAX),
    contents: z.unknown()
      .refine(isBroadcastFlexContainer, "Flex の最上位は bubble または carousel である必要があります"),
  }),
]);

export const createBroadcastSchema = z.object({
  name:    z.string().min(1).max(100),
  content: broadcastContentSchema,
}).and(broadcastTargetSchema);

export const updateBroadcastSchema = z.object({
  name:    z.string().min(1).max(100).optional(),
  content: broadcastContentSchema.optional(),
}).and(broadcastTargetSchema.or(z.object({}).strict()));

export function toTarget(input: z.infer<typeof broadcastTargetSchema>) {
  return input.target_type === "all"
    ? ({ type: "all" } as const)
    : ({ type: "segment", segmentId: input.segment_id, workId: input.work_id } as const);
}

export function toBroadcastResponse(b: {
  id: string; oaId: string; name: string; status: string;
  targetType: string; segmentId: string | null; segmentWorkId: string | null;
  contentJson: unknown; recipientCount: number; successCount: number; failureCount: number;
  createdByUserId: string | null;
  startedAt: Date | null; completedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id:              b.id,
    oa_id:           b.oaId,
    name:            b.name,
    status:          b.status,
    target_type:     b.targetType,
    segment_id:      b.segmentId,
    segment_work_id: b.segmentWorkId,
    content:         b.contentJson,
    recipient_count: b.recipientCount,
    success_count:   b.successCount,
    failure_count:   b.failureCount,
    started_at:      b.startedAt,
    completed_at:    b.completedAt,
    created_at:      b.createdAt,
    updated_at:      b.updatedAt,
  };
}
