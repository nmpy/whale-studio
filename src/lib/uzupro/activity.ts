// src/lib/uzupro/activity.ts
// for ウズプロ機能のアクティビティログ（UzuProActivityLog）書き込みヘルパー。
//
// 重要（spec §4/§11）: 個人情報（氏名/メール/電話/住所/備考/LINE UID 生値）を detail に含めない。
//   detail には件数・状態・匿名 ref（externalBookingId 等）のみを入れる。
// 権限付与/解除は platform owner 操作のため AdminAuditLog 側に記録し、ここには入れない。

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export type UzuProAction =
  | "sync_success"
  | "sync_failure"
  | "liff_issue"
  | "liff_bulk_issue"
  | "liff_revoke"
  | "liff_reissue"
  /// PR2 で使用（LINE User ID 紐づけ）
  | "line_link"
  /// 作品単位の for UZU Pro 有効化 / 無効化（owner / platform owner 操作）
  | "work_enabled"
  | "work_disabled"
  /// UzuProGrant 付与 / 解除（platform owner 操作）
  | "grant_granted"
  | "grant_revoked";

export type UzuProTargetType = "booking" | "player" | "liff_link" | "sync" | "work" | "grant";

/**
 * PII を含めない前提の監査ログを書き込む。
 * detail は JSON 文字列（件数/状態/匿名 ref のみ）。呼び出し側で PII を渡さないこと。
 */
export async function recordUzuProActivity(
  db: Db,
  args: {
    oaId?: string | null;
    workId?: string | null;
    actorUserId?: string | null;
    action: UzuProAction;
    targetType?: UzuProTargetType | null;
    targetId?: string | null;
    detail?: Record<string, unknown> | null;
  },
): Promise<void> {
  await db.uzuProActivityLog.create({
    data: {
      oaId: args.oaId ?? null,
      workId: args.workId ?? null,
      actorUserId: args.actorUserId ?? null,
      action: args.action,
      targetType: args.targetType ?? null,
      targetId: args.targetId ?? null,
      detail: args.detail ? JSON.stringify(args.detail) : null,
    },
  });
}
