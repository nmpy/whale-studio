"use client";

/**
 * useWorkLimit — 現在 OA の作品数上限をプラン情報から取得するフック
 *
 * GET /api/oas/:id/plan-info (viewer 以上) を呼び出す。
 * Subscription 未設定の場合は maxWorks = null（判定不能）を返す。
 *
 * options.previewPlan が指定されている場合は ?previewPlan=<tier> として送り、
 * サーバ側で owner / platform admin のみそのティアの Plan 情報を返す
 * (= 表示確認モード用)。非 owner は API 側で無視される。
 *
 * perf: 同一 oaId + previewPlan に対する未解決 fetch は module-scope の inflight
 *       Map で共有する (= 同 OA 配下で複数コンポーネントが同時 mount しても 1 回に
 *       短絡)。useWorkspaceRole と同じ pattern。
 *
 * @example
 * const { maxWorks, planDisplayName, loading } = useWorkLimit(oaId);
 * const atLimit = maxWorks !== null && maxWorks !== -1 && works.length >= maxWorks;
 */

import { useState, useEffect } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import type { PlanTier } from "@/lib/constants/plans";

type PlanInfoResponse = {
  success: boolean;
  data?: {
    max_works: number | null;
    display_name: string | null;
    plan_name: string | null;
  };
};

// 同一 (oaId, previewPlan) への未解決 fetch を共有して重複排除する。
// settle 時に Map から削除し、stale 値の再利用を防ぐ。
//
// 安全性:
//   - key には oaId が必ず入る → OA 跨ぎ汚染なし。
//   - settle (= resolve / reject) 時点で entry を必ず削除 → 完了済みの古い Promise を
//     後続の呼び出し元が再利用することは無い (= "完了済みキャッシュ" として残らない)。
//   - ユーザー切替 (= ログアウト → 別ユーザーログイン) は通常ページ全体 reload を伴い、
//     module-scope Map は reset される。SPA 内だけで認証コンテキストが切り替わる経路は
//     現状想定しないため、ここでは userId を key に含めない。
//   - cancelled flag で unmount 後 setState を抑止し、stale 状態を component に反映しない。
const inflight = new Map<string, Promise<PlanInfoResponse>>();

export interface WorkLimitState {
  /** 作品数上限。-1 = 無制限、null = 未設定（Subscription なし） */
  maxWorks:        number | null;
  /** プラン表示名（例: "テスタープラン"）。未設定時は null */
  planDisplayName: string | null;
  /** プランコード名（例: "tester"）。未設定時は null */
  planName:        string | null;
  /** データ取得中かどうか */
  loading:         boolean;
}

export interface UseWorkLimitOptions {
  /** 表示確認モード時、UI が「このティアだったらどう表示されるか」を確認するために
   *  サーバへ ?previewPlan=<tier> を送る。owner のみサーバが honor する (= 非 owner は無視)。
   *  null / undefined なら通常パス。 */
  previewPlan?: PlanTier | null;
}

export function useWorkLimit(oaId: string, options?: UseWorkLimitOptions): WorkLimitState {
  const [maxWorks,        setMaxWorks]        = useState<number | null>(null);
  const [planDisplayName, setPlanDisplayName] = useState<string | null>(null);
  const [planName,        setPlanName]        = useState<string | null>(null);
  const [loading,         setLoading]         = useState(true);

  const previewPlan = options?.previewPlan ?? null;

  useEffect(() => {
    if (!oaId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const key = `${oaId}::${previewPlan ?? ""}`;
    const qs  = previewPlan ? `?previewPlan=${encodeURIComponent(previewPlan)}` : "";

    let promise = inflight.get(key);
    if (!promise) {
      promise = fetch(`/api/oas/${oaId}/plan-info${qs}`, {
        headers: { ...getAuthHeaders() },
      })
        .then((res) => (res.ok ? res.json() as Promise<PlanInfoResponse> : Promise.reject(res.status)))
        .finally(() => { inflight.delete(key); });
      inflight.set(key, promise);
    }

    promise
      .then((json) => {
        if (cancelled) return;
        if (json.success && json.data) {
          setMaxWorks(json.data.max_works ?? null);
          setPlanDisplayName(json.data.display_name ?? null);
          setPlanName(json.data.plan_name ?? null);
        } else {
          // Subscription 未設定
          setMaxWorks(null);
          setPlanDisplayName(null);
          setPlanName(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // 取得失敗時は未設定扱い (= 制限なしとして動作)
        setMaxWorks(null);
        setPlanDisplayName(null);
        setPlanName(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [oaId, previewPlan]);

  return { maxWorks, planDisplayName, planName, loading };
}
