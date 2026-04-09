// src/lib/checkin-attempt.ts
// CheckinAttempt の重複抑制 + retention (保持ポリシー) ヘルパー。
//
// ■ 重複抑制ルール:
//   同一 (workId, locationId, lineUserId, status) の組み合わせが
//   直近 DEDUP_WINDOW_SECONDS 秒以内に存在する場合、新規保存をスキップする。
//   → ユーザーの UX は変わらない。抑制するのは DB に保存するログだけ。
//   → 複合 index (workId, locationId, lineUserId, status, createdAt) で高速検索。
//
// ■ retention 方針:
//   RETENTION_DAYS (デフォルト 90日) 以前のレコードを削除対象とする。
//   削除は cleanupOldAttempts() を手動/バッチ/内部 API から呼ぶ。
//   lat/lng も含めて retention 期限でレコードごと削除する（方針 A）。
//
// ■ lat/lng の保持方針:
//   retention cleanup でレコードごと削除。特別な null 化処理は行わない。
//
// ■ 自動 cleanup の実行方法:
//   手動: npx tsx scripts/cleanup-checkin-attempts.ts [--days N] [--dry-run]
//   API:  POST /api/internal/cleanup/checkin-attempts (CRON_SECRET 必須)
//   Cron: Vercel Cron / Cloud Scheduler から上記 API を呼ぶ

import { prisma } from "@/lib/prisma";

/** 同一条件の試行を間引く時間窓（秒） */
const DEDUP_WINDOW_SECONDS = 15;

/** 試行ログの保持日数 */
export const RETENTION_DAYS = 90;

/**
 * 最近の重複ログがあるか確認する。
 * true = 重複あり（保存スキップすべき）
 *
 * 複合 index (workId, locationId, lineUserId, status, createdAt) で高速検索。
 */
export async function hasDuplicateAttempt(params: {
  workId: string;
  locationId: string;
  lineUserId: string;
  status: string;
}): Promise<boolean> {
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_SECONDS * 1000);
  const existing = await prisma.checkinAttempt.findFirst({
    where: {
      workId:     params.workId,
      locationId: params.locationId,
      lineUserId: params.lineUserId,
      status:     params.status,
      createdAt:  { gte: cutoff },
    },
    select: { id: true },
  });
  return !!existing;
}

/**
 * 重複チェック付きで試行ログを保存する。
 * 重複があればスキップして false を返す。保存したら true を返す。
 */
export async function logAttemptDeduped(data: {
  workId: string;
  locationId: string;
  lineUserId: string;
  method: string;
  status: string;
  failureReason?: string;
  distanceMeters?: number;
  lat?: number;
  lng?: number;
}): Promise<boolean> {
  const isDuplicate = await hasDuplicateAttempt({
    workId: data.workId, locationId: data.locationId,
    lineUserId: data.lineUserId, status: data.status,
  });
  if (isDuplicate) return false;

  await prisma.checkinAttempt.create({
    data: {
      workId: data.workId, locationId: data.locationId, lineUserId: data.lineUserId,
      method: data.method, status: data.status,
      failureReason: data.failureReason ?? null,
      distanceMeters: data.distanceMeters ?? null,
      lat: data.lat ?? null, lng: data.lng ?? null,
    },
  });
  return true;
}

export interface CleanupResult {
  cutoffDate: string;
  retentionDays: number;
  deletedCount: number;
  dryRun: boolean;
}

/**
 * 古い試行ログを削除する（retention cleanup）。
 *
 * @param retentionDays 保持日数（デフォルト: RETENTION_DAYS）
 * @param dryRun true なら実際には削除せず件数だけ返す
 * @returns 削除件数 + メタ情報
 */
export async function cleanupOldAttempts(
  retentionDays = RETENTION_DAYS,
  dryRun = false,
): Promise<CleanupResult> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  if (dryRun) {
    const count = await prisma.checkinAttempt.count({
      where: { createdAt: { lt: cutoff } },
    });
    return {
      cutoffDate: cutoff.toISOString(),
      retentionDays,
      deletedCount: count,
      dryRun: true,
    };
  }

  // batch delete: 1000 件ずつで DB 負荷を抑制
  let totalDeleted = 0;
  const BATCH_SIZE = 1000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await prisma.checkinAttempt.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    await prisma.checkinAttempt.deleteMany({
      where: { id: { in: batch.map((r) => r.id) } },
    });
    totalDeleted += batch.length;
    if (batch.length < BATCH_SIZE) break;
  }

  return {
    cutoffDate: cutoff.toISOString(),
    retentionDays,
    deletedCount: totalDeleted,
    dryRun: false,
  };
}
