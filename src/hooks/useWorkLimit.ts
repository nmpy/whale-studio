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
 * @example
 * const { maxWorks, planDisplayName, loading } = useWorkLimit(oaId);
 * const atLimit = maxWorks !== null && maxWorks !== -1 && works.length >= maxWorks;
 */

import { useState, useEffect } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import type { PlanTier } from "@/lib/constants/plans";
import { createTtlCache } from "@/lib/client-cache";

/** plan-info の取得結果。stale-while-revalidate cache に格納する形。 */
type PlanInfo = {
  maxWorks:        number | null;
  planDisplayName: string | null;
  planName:        string | null;
};

// (oaId, previewPlan) ごとの plan-info を 45s だけ共有する。
// AppHeader / page / AccessPreviewBar の重複呼び出し + 画面遷移ごとの再 fetch を抑える。
// auth 変化時は clearAllTtlCaches() で破棄される（client-cache.ts 参照）。
const PLAN_TTL_MS = 45_000;
const planCache = createTtlCache<PlanInfo>(PLAN_TTL_MS);
// 同一 key の未解決 fetch を共有して同時多発を 1 本に束ねる。
const planInflight = new Map<string, Promise<PlanInfo>>();

function planKey(oaId: string, previewPlan: PlanTier | null): string {
  return `${oaId}::${previewPlan ?? ""}`;
}

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
    const key = planKey(oaId, previewPlan);

    function apply(info: PlanInfo) {
      setMaxWorks(info.maxWorks);
      setPlanDisplayName(info.planDisplayName);
      setPlanName(info.planName);
    }

    // 1) cache hit があれば即時反映（loading フラッシュ・遷移ごとの再取得待ちをなくす）。
    const cached = planCache.get(key);
    if (cached) {
      apply(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    // 2) 常に revalidate（同一 key の同時 fetch は inflight で 1 本に束ねる）。
    let promise = planInflight.get(key);
    if (!promise) {
      const qs = previewPlan ? `?previewPlan=${encodeURIComponent(previewPlan)}` : "";
      promise = fetch(`/api/oas/${oaId}/plan-info${qs}`, { headers: { ...getAuthHeaders() } })
        .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
        .then((json): PlanInfo =>
          json.success && json.data
            ? { maxWorks: json.data.max_works, planDisplayName: json.data.display_name, planName: json.data.plan_name }
            : { maxWorks: null, planDisplayName: null, planName: null },
        )
        .catch((): PlanInfo => ({ maxWorks: null, planDisplayName: null, planName: null }))
        .finally(() => { planInflight.delete(key); });
      planInflight.set(key, promise);
    }

    promise.then((info) => {
      planCache.set(key, info);
      if (cancelled) return;
      apply(info);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [oaId, previewPlan]);

  return { maxWorks, planDisplayName, planName, loading };
}
