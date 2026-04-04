"use client";

/**
 * useWorkLimit — 現在 OA の作品数上限をプラン情報から取得するフック
 *
 * GET /api/oas/:id/plan-info (viewer 以上) を呼び出す。
 * Subscription 未設定の場合は maxWorks = null（判定不能）を返す。
 *
 * @example
 * const { maxWorks, planDisplayName, loading } = useWorkLimit(oaId);
 * const atLimit = maxWorks !== null && maxWorks !== -1 && works.length >= maxWorks;
 */

import { useState, useEffect } from "react";
import { getDevToken } from "@/lib/api-client";

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

export function useWorkLimit(oaId: string): WorkLimitState {
  const [maxWorks,        setMaxWorks]        = useState<number | null>(null);
  const [planDisplayName, setPlanDisplayName] = useState<string | null>(null);
  const [planName,        setPlanName]        = useState<string | null>(null);
  const [loading,         setLoading]         = useState(true);

  useEffect(() => {
    if (!oaId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`/api/oas/${oaId}/plan-info`, {
      headers: { Authorization: `Bearer ${getDevToken()}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((json) => {
        if (json.success && json.data) {
          setMaxWorks(json.data.max_works);
          setPlanDisplayName(json.data.display_name);
          setPlanName(json.data.plan_name);
        } else {
          // Subscription 未設定
          setMaxWorks(null);
          setPlanDisplayName(null);
          setPlanName(null);
        }
      })
      .catch(() => {
        // 取得失敗時は未設定扱い（制限なしとして動作）
        setMaxWorks(null);
        setPlanDisplayName(null);
        setPlanName(null);
      })
      .finally(() => setLoading(false));
  }, [oaId]);

  return { maxWorks, planDisplayName, planName, loading };
}
