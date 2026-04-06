// src/app/api/analytics/resume/route.ts
// GET /api/analytics/resume — 再開導線 UX 分析（プラットフォームオーナー専用）
//
// 集計対象イベント:
//   resume_choice_shown    — 再開選択肢を提示した件数（ファネル母数）
//   resume_choice_selected — ユーザーが選択した件数 / mode 内訳
//   resume_completed       — 再開後にエンディングへ到達した件数
//
// 集計方式: 全件 findMany → payload を JSON パース → in-memory 集計
//           （EventLog.payload は JSON 文字列のため SQL 集計が難しい）
//
// レスポンス: ResumeAnalytics（下部に型定義）

import { prisma }             from "@/lib/prisma";
import { ok, serverError }   from "@/lib/api-response";
import { withPlatformAdmin } from "@/lib/with-platform-admin";
import type {
  ResumeChoiceShownPayload,
  ResumeChoiceSelectedPayload,
  ResumeCompletedPayload,
} from "@/lib/constants/event-names";

// ── レスポンス型 ──────────────────────────────────────────────────────────

/** ファネル全体の集計 */
export interface ResumeFunnel {
  /** resume_choice_shown 件数（ファネル母数） */
  shown:            number;
  /** resume_choice_selected 件数（選択まで進んだ数） */
  selected_total:   number;
  /** mode=resume の件数 */
  selected_resume:  number;
  /** mode=restart の件数 */
  selected_restart: number;
  /** resume_completed 件数 */
  completed:        number;
  /** selected_total / shown (%) — 何%が選択まで進んだか */
  selection_rate:   number;
  /** selected_resume / selected_total (%) — 選んだ人のうち「再開」を選んだ割合 */
  resume_rate:      number;
  /** completed / selected_resume (%) — 再開後の完走率 */
  completion_rate:  number;
}

/** フェーズごとの再開・完走集計 */
export interface PhaseResumeStats {
  /** 離脱していたフェーズ ID */
  phase_id:        string;
  /** resume_choice_selected[mode=resume] の件数（このフェーズが起点） */
  resume_count:    number;
  /** resume_completed の件数（このフェーズが起点） */
  completed_count: number;
  /** completed_count / resume_count (%) */
  completion_rate: number;
}

/** resumeSummary 有無による再開率・完走率の比較 */
export interface SummaryGroupStats {
  /** 再開選択数（mode=resume） */
  resume_count:    number;
  /** 完走数 */
  completed_count: number;
  /** completed_count / resume_count (%) */
  completion_rate: number;
}

export interface SummaryEffect {
  with_summary:    SummaryGroupStats;
  without_summary: SummaryGroupStats;
}

export interface ResumeAnalytics {
  /** 集計対象イベントの総件数 */
  total_events:   number;
  funnel:         ResumeFunnel;
  /** フェーズ別集計（再開数の多い順） */
  by_phase:       PhaseResumeStats[];
  /** resumeSummary 有無による再開率・完走率の比較 */
  summary_effect: SummaryEffect;
}

// ── ヘルパー ──────────────────────────────────────────────────────────────

/** 0 除算を避けた割合計算（0〜100 の整数 %） */
function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

// ── API ハンドラ ──────────────────────────────────────────────────────────

export const GET = withPlatformAdmin(async () => {
  try {
    // 3 種類のイベントを一括取得（payload + eventName が必要）
    const rows = await prisma.eventLog.findMany({
      where: {
        eventName: {
          in: ["resume_choice_shown", "resume_choice_selected", "resume_completed"],
        },
      },
      select:  { eventName: true, payload: true },
      orderBy: { createdAt: "desc" },
    });

    const total_events = rows.length;

    // ── ペイロードをイベント種別ごとに振り分け・パース ──────────────────
    const shown:     ResumeChoiceShownPayload[]    = [];
    const selected:  ResumeChoiceSelectedPayload[] = [];
    const completed: ResumeCompletedPayload[]      = [];

    for (const row of rows) {
      try {
        const p = JSON.parse(row.payload);
        if (row.eventName === "resume_choice_shown")    shown.push(p     as ResumeChoiceShownPayload);
        if (row.eventName === "resume_choice_selected") selected.push(p  as ResumeChoiceSelectedPayload);
        if (row.eventName === "resume_completed")       completed.push(p as ResumeCompletedPayload);
      } catch {
        // 不正 JSON は無視
      }
    }

    // ── 1. ファネル集計 ──────────────────────────────────────────────────
    const selectedResume  = selected.filter((s) => s.mode === "resume");
    const selectedRestart = selected.filter((s) => s.mode === "restart");

    const funnel: ResumeFunnel = {
      shown:            shown.length,
      selected_total:   selected.length,
      selected_resume:  selectedResume.length,
      selected_restart: selectedRestart.length,
      completed:        completed.length,
      selection_rate:   pct(selected.length,        shown.length),
      resume_rate:      pct(selectedResume.length,  selected.length),
      completion_rate:  pct(completed.length,       selectedResume.length),
    };

    // ── 2. フェーズ別集計 ─────────────────────────────────────────────────
    // 再開選択（mode=resume）の current_phase_id を集計
    const resumeCountByPhase    = new Map<string, number>();
    const completedCountByPhase = new Map<string, number>();

    for (const s of selectedResume) {
      if (s.current_phase_id) {
        resumeCountByPhase.set(
          s.current_phase_id,
          (resumeCountByPhase.get(s.current_phase_id) ?? 0) + 1,
        );
      }
    }

    for (const c of completed) {
      if (c.resumed_from_phase_id) {
        completedCountByPhase.set(
          c.resumed_from_phase_id,
          (completedCountByPhase.get(c.resumed_from_phase_id) ?? 0) + 1,
        );
      }
    }

    // フェーズ ID の和集合（再開あり or 完走あり）
    const allPhaseIds = new Set([
      ...resumeCountByPhase.keys(),
      ...completedCountByPhase.keys(),
    ]);

    const by_phase: PhaseResumeStats[] = [...allPhaseIds]
      .map((phase_id) => {
        const resume_count    = resumeCountByPhase.get(phase_id)    ?? 0;
        const completed_count = completedCountByPhase.get(phase_id) ?? 0;
        return {
          phase_id,
          resume_count,
          completed_count,
          completion_rate: pct(completed_count, resume_count),
        };
      })
      .sort((a, b) => b.resume_count - a.resume_count);

    // ── 3. resumeSummary 有無による比較 ────────────────────────────────────
    // resume_choice_selected[mode=resume] の has_resume_summary で分類
    const resumeWithSummary    = selectedResume.filter((s) => s.has_resume_summary === true);
    const resumeWithoutSummary = selectedResume.filter((s) => s.has_resume_summary !== true);

    // 完走イベントも has_resume_summary で分類
    const completedWithSummary    = completed.filter((c) => c.has_resume_summary === true);
    const completedWithoutSummary = completed.filter((c) => c.has_resume_summary !== true);

    const summary_effect: SummaryEffect = {
      with_summary: {
        resume_count:    resumeWithSummary.length,
        completed_count: completedWithSummary.length,
        completion_rate: pct(completedWithSummary.length, resumeWithSummary.length),
      },
      without_summary: {
        resume_count:    resumeWithoutSummary.length,
        completed_count: completedWithoutSummary.length,
        completion_rate: pct(completedWithoutSummary.length, resumeWithoutSummary.length),
      },
    };

    return ok<ResumeAnalytics>({
      total_events,
      funnel,
      by_phase,
      summary_effect,
    });
  } catch (err) {
    return serverError(err);
  }
});
