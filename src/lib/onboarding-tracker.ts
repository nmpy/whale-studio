// src/lib/onboarding-tracker.ts
// サーバーサイド: オンボーディングステップを fire-and-forget で記録するヘルパー。
//
// ・@@unique([workId, step]) によりダブル記録は自動スキップ
// ・await しないことを推奨（リクエストをブロックしない）
// ・エラーはサイレントに無視する

import { prisma } from "@/lib/prisma";
import type { OnboardingStep } from "@/lib/constants/onboarding";

/**
 * オンボーディングステップの初回完了を記録する。
 *
 * @example
 * // fire-and-forget: return の前に await せず呼び出す
 * trackOnboardingStep(work.id, data.oa_id, "work_created");
 * return created(toResponse(work));
 */
export function trackOnboardingStep(
  workId: string,
  oaId:   string,
  step:   OnboardingStep,
): void {
  prisma.onboardingEvent
    .upsert({
      where:  { workId_step: { workId, step } },
      update: {}, // 既存なら何もしない（初回のみ記録）
      create: { workId, oaId, step },
    })
    .catch(() => { /* fire-and-forget: エラーは無視 */ });
}
