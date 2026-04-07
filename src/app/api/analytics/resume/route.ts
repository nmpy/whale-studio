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

// ── 改善候補しきい値（将来調整しやすいよう定数化）──────────────────────────
//
//   IMPROVEMENT_MIN_RESUME — 再開数がこの値を超えるフェーズのみ候補に含める。
//     少なすぎるサンプルでの完走率は信頼性が低いため除外する。
//
//   IMPROVEMENT_MAX_COMPLETION_PCT — 完走率がこの値未満のフェーズを「改善の余地あり」と判断。
//     40% を初期値として設定。一般的な謎解きシナリオの期待完走率を参考にした。
//
//   将来的には Work 単位・期間フィルタ等でしきい値を動的に変えることも検討できる。
//
const IMPROVEMENT_MIN_RESUME         = 5;   // 再開数の下限（母数確保）
const IMPROVEMENT_MAX_COMPLETION_PCT = 40;  // 完走率の上限（これ未満を改善候補とする）

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

/** フェーズごとの再開・完走集計（改善指標付き） */
export interface PhaseResumeStats {
  /** 離脱していたフェーズ ID */
  phase_id:                string;
  /** resume_choice_selected[mode=resume] の件数（このフェーズが起点） */
  resume_count:            number;
  /** resume_completed の件数（このフェーズが起点） */
  completed_count:         number;
  /** completed_count / resume_count (%) */
  completion_rate:         number;
  /**
   * 改善優先スコア = resume_count × (1 - completion_rate / 100)
   * 再開数が多く・完走率が低いフェーズほど高くなる。
   * スコアが大きいほど「多くの人が詰まっており、完走に至っていない」ことを示す。
   */
  score:                   number;
  /**
   * このフェーズで最後に記録された has_resume_summary の値。
   * null = まだデータが蓄積されていない（イベントなし）
   */
  has_resume_summary:      boolean | null;
  /**
   * 改善候補フラグ（IMPROVEMENT_MIN_RESUME & IMPROVEMENT_MAX_COMPLETION_PCT による判定）。
   * true のとき UI で amber バッジを表示する。
   */
  is_improvement_candidate: boolean;
  /**
   * あらすじ追加推奨フラグ。
   * 改善候補 かつ resumeSummary 未設定のフェーズに true を付与する。
   */
  suggest_add_summary:     boolean;
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
  /**
   * フェーズ別集計（スコア降順 → 再開数降順）。
   * 改善候補フラグ・あらすじ推奨フラグを含む。
   */
  by_phase:            PhaseResumeStats[];
  /**
   * 改善優先フェーズ（is_improvement_candidate=true のサブセット、スコア降順）。
   * UI の最上部に「まず対応すべきフェーズ」として表示する。
   */
  improvement_candidates: PhaseResumeStats[];
  /** resumeSummary 有無による再開率・完走率の比較 */
  summary_effect:  SummaryEffect;
}

// ── ヘルパー ──────────────────────────────────────────────────────────────

/** 0 除算を避けた割合計算（0〜100 の整数 %） */
function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

/**
 * 改善優先スコアの計算。
 * score = resume_count × (1 - completion_rate / 100)
 * 値が大きい＝再開数多 × 完走率低 → 優先して対処する価値が高い。
 * 小数第2位で丸める。
 */
function improvementScore(resume_count: number, completion_rate: number): number {
  return Math.round(resume_count * (1 - completion_rate / 100) * 100) / 100;
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

    // ── 2. フェーズ別集計 + 改善スコア算出 ──────────────────────────────
    const resumeCountByPhase    = new Map<string, number>();
    const completedCountByPhase = new Map<string, number>();
    // フェーズごとの has_resume_summary（最初に登場した値を採用 = 降順なので最新値）
    const hasSummaryByPhase     = new Map<string, boolean>();

    for (const s of selectedResume) {
      if (!s.current_phase_id) continue;
      resumeCountByPhase.set(
        s.current_phase_id,
        (resumeCountByPhase.get(s.current_phase_id) ?? 0) + 1,
      );
      // 最新の has_resume_summary を記録（後から変更された場合でも最新優先）
      if (!hasSummaryByPhase.has(s.current_phase_id)) {
        hasSummaryByPhase.set(s.current_phase_id, s.has_resume_summary ?? false);
      }
    }

    for (const c of completed) {
      if (!c.resumed_from_phase_id) continue;
      completedCountByPhase.set(
        c.resumed_from_phase_id,
        (completedCountByPhase.get(c.resumed_from_phase_id) ?? 0) + 1,
      );
    }

    // フェーズ ID の和集合（再開あり or 完走あり）
    const allPhaseIds = new Set([
      ...resumeCountByPhase.keys(),
      ...completedCountByPhase.keys(),
    ]);

    const by_phase: PhaseResumeStats[] = [...allPhaseIds]
      .map((phase_id): PhaseResumeStats => {
        const resume_count    = resumeCountByPhase.get(phase_id)    ?? 0;
        const completed_count = completedCountByPhase.get(phase_id) ?? 0;
        const completion_rate = pct(completed_count, resume_count);
        const score           = improvementScore(resume_count, completion_rate);
        // has_resume_summary: null は「このフェーズの選択イベントがまだない」状態
        const has_resume_summary     = hasSummaryByPhase.get(phase_id) ?? null;
        // 改善候補判定
        //   条件1: 再開数が下限（IMPROVEMENT_MIN_RESUME）を超えている（母数確保）
        //   条件2: 完走率が上限（IMPROVEMENT_MAX_COMPLETION_PCT）未満
        const is_improvement_candidate =
          resume_count > IMPROVEMENT_MIN_RESUME &&
          completion_rate < IMPROVEMENT_MAX_COMPLETION_PCT;
        // あらすじ追加推奨: 改善候補 かつ resumeSummary 未設定
        const suggest_add_summary =
          is_improvement_candidate && has_resume_summary === false;

        return {
          phase_id,
          resume_count,
          completed_count,
          completion_rate,
          score,
          has_resume_summary,
          is_improvement_candidate,
          suggest_add_summary,
        };
      })
      // スコア降順 → 再開数降順（スコアが同値のとき再開数が多い方を上位に）
      .sort((a, b) => b.score - a.score || b.resume_count - a.resume_count);

    // 改善候補サブセット（スコア降順済み）
    const improvement_candidates = by_phase.filter((p) => p.is_improvement_candidate);

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
      improvement_candidates,
      summary_effect,
    });
  } catch (err) {
    return serverError(err);
  }
});
