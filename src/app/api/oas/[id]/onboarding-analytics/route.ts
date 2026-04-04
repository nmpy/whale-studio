// src/app/api/oas/[id]/onboarding-analytics/route.ts
// GET /api/oas/[id]/onboarding-analytics — オンボーディング分析データ取得
//
// 権限: owner のみ
// 集計方法:
//   - work_created〜flow_connected: DB の現在状態から算出（遡及対応・正確）
//   - previewed: OnboardingProgress テーブルのみから算出（Phase 4 で fallback 削除）
//               ※ Phase 3 以前の OnboardingEvent データは参照しない（わずかな過去データは許容）

import { withRole } from "@/lib/auth";
import { ok, serverError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { ONBOARDING_STEPS, ONBOARDING_STEP_LABELS, ONBOARDING_STEP_DESCS } from "@/lib/constants/onboarding";
import type { OnboardingStep } from "@/lib/constants/onboarding";

export const GET = withRole(
  ({ params }) => (params as { id: string }).id,
  ["owner"] as const,
  async (req, { params }) => {
    const oaId = (params as { id: string }).id;

    try {
      // ── 1. 全作品を集計に必要な情報と共に取得 ──────────────────────
      const works = await prisma.work.findMany({
        where: { oaId },
        select: {
          id: true,
          _count: {
            select: {
              characters:  true,
              messages:    true,
              transitions: true,
            },
          },
          // global フェーズ以外のフェーズが1件でもあるか確認
          phases: {
            where:  { phaseType: { not: "global" } },
            select: { id: true },
            take:   1,
          },
        },
      });

      const total = works.length;

      // ── 2. previewed は OnboardingProgress のみから取得（Phase 4: fallback 削除）──
      // OnboardingEvent への write は Phase 3 で停止済み。
      // Phase 3 以前の旧データは OnboardingProgress に移行されないが、誤差は許容する。
      const progressRows = await prisma.onboardingProgress.findMany({
        where:  { step: "previewed", work: { oaId } },
        select: { workId: true },
        distinct: ["workId"],
      });
      const previewedIds = new Set(progressRows.map((r) => r.workId));

      // ── 3. ステップごとの到達作品数を集計 ────────────────────────────
      const counts: Record<OnboardingStep, number> = {
        work_created:      total,
        character_created: works.filter((w) => w._count.characters  > 0).length,
        phase_created:     works.filter((w) => w.phases.length       > 0).length,
        message_created:   works.filter((w) => w._count.messages     > 0).length,
        flow_connected:    works.filter((w) => w._count.transitions  > 0).length,
        previewed:         works.filter((w) => previewedIds.has(w.id)).length,
      };

      // ── 4. ファネルデータを構築 ──────────────────────────────────────
      const funnel = ONBOARDING_STEPS.map((step) => {
        const count = counts[step];
        const rate  = total > 0 ? count / total : 0;
        return {
          step,
          label: ONBOARDING_STEP_LABELS[step],
          desc:  ONBOARDING_STEP_DESCS[step],
          count,
          rate: Math.round(rate * 1000) / 10, // 小数第1位まで（%表示用）
        };
      });

      // ── 5. ステップ間のドロップオフを計算 ────────────────────────────
      const funnelWithDropoff = funnel.map((s, i) => {
        const prevCount = i === 0 ? total : funnel[i - 1].count;
        const dropoff   = prevCount > 0 ? (prevCount - s.count) / prevCount : 0;
        return {
          ...s,
          dropoff_from_prev: Math.round(dropoff * 1000) / 10,
        };
      });

      return ok({
        oa_id:       oaId,
        total_works: total,
        funnel:      funnelWithDropoff,
      });
    } catch (err) {
      return serverError(err);
    }
  }
);
