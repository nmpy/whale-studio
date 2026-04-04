// src/lib/onboarding.ts
// ユーザー単位のオンボーディング進捗記録（OnboardingProgress テーブル）
//
// 設計:
//   - 「1ユーザー × 1作品 × 1ステップ」で1回だけ記録
//   - @@unique([userId, workId, step]) を活用した upsert で重複を DB レベルで防止
//   - update: {} → 既存行があっても上書きしない（初回日時を保持）
//   - 呼び出し側は fire-and-forget 推奨（リクエストをブロックしない）
//
// 使い方:
//   trackOnboardingProgress({ userId: user.id, workId, step: "work_created" });
//   // await しない — エラーはサイレントに無視される

import { prisma } from "@/lib/prisma";
import type { OnboardingStep } from "@/lib/constants/onboarding";

/**
 * ユーザー × 作品 × ステップ の進捗を記録する。
 *
 * - 同じ組み合わせが既に存在する場合は何もしない（初回到達日時を保持）
 * - Promise を返すが、呼び出し側は通常 await しない（fire-and-forget）
 *
 * @example
 * // fire-and-forget: return の直前に await せず呼ぶ
 * trackOnboardingProgress({ userId: user.id, workId: work.id, step: "work_created" });
 * return created(toResponse(work));
 */
export async function trackOnboardingProgress({
  userId,
  workId,
  step,
}: {
  userId: string;
  workId: string;
  step: OnboardingStep;
}): Promise<void> {
  try {
    await prisma.onboardingProgress.upsert({
      where:  { userId_workId_step: { userId, workId, step } },
      update: {}, // 既存なら何もしない（createdAt を上書きしない）
      create: { userId, workId, step },
    });
  } catch (err) {
    // ログ記録の失敗は本処理に影響させない（サイレントに無視）
    console.error("[trackOnboardingProgress] failed to record step:", step, err);
  }
}
