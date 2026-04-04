// src/app/api/analytics/onboarding/route.ts
// GET /api/analytics/onboarding — オンボーディング集計（プラットフォームオーナー専用）
//
// 集計対象: OnboardingProgress テーブル（ユーザー × 作品 × ステップ の初回到達記録）
//
// レスポンス:
//   total_started  : work_created の記録数（分母）
//   steps[]        : ステップごとの到達数・到達率
//   rate の計算式  : Math.round((count / total_started) * 100)
//   未記録ステップ  : count=0, rate=0 で返す
//   0除算対策      : total_started === 0 のとき全 rate を 0 にする

import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withPlatformAdmin } from "@/lib/with-platform-admin";
import { ONBOARDING_STEPS } from "@/lib/constants/onboarding";

export const GET = withPlatformAdmin(async (_req, _ctx, _user) => {
  try {
    // ── ステップ別のレコード数を一括取得 ────────────────────────────
    // OnboardingProgress は @@unique([userId, workId, step]) なので
    // groupBy の _count はそのまま「ユニークな到達数」になる
    const rows = await prisma.onboardingProgress.groupBy({
      by:    ["step"],
      _count: { step: true },
    });

    // Map に変換して O(1) で参照できるようにする
    const countMap = new Map<string, number>(
      rows.map((r) => [r.step, r._count.step])
    );

    // ── 分母: work_created の到達数 ─────────────────────────────────
    const totalStarted = countMap.get("work_created") ?? 0;

    // ── ステップ順に整形（未記録ステップは 0 補完） ─────────────────
    const steps = ONBOARDING_STEPS.map((step) => {
      const count = countMap.get(step) ?? 0;
      const rate  = totalStarted > 0
        ? Math.round((count / totalStarted) * 100)
        : 0;
      return { step, count, rate };
    });

    return ok({ total_started: totalStarted, steps });
  } catch (err) {
    return serverError(err);
  }
});
