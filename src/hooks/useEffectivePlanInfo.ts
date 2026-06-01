"use client";

// src/hooks/useEffectivePlanInfo.ts
//
// 表示確認モード (= access preview) を考慮した「現在 UI が見るべきプラン情報」を返すフック。
//
// ## 役割の住み分け
//
// - `useWorkLimit(oaId)` : 実プラン情報 (= 課金・上限の事実)。preview 非対応。
// - `useEffectivePlanInfo(oaId)` (本ファイル) : UI 表示用。preview 中は preview tier の Plan 情報を返す。
//
// ## 仕組み
//
// 1. `useAccessPreview(oaId)` で previewPlan / isPreviewingPlan を取得
// 2. `useWorkLimit(oaId, { previewPlan })` を呼ぶ
//    - preview 中 → サーバが `?previewPlan` を honor し Plan テーブルからその tier の情報を返す
//    - 非 preview → 通常パス (= owner の real Subscription / platform admin の Pro Max 合成)
// 3. 戻り値で UI が見るべき maxWorks / displayName / planName / effectivePlan を提供
//
// ## API ガードの安全性
//
// `?previewPlan` はサーバ側で owner (= rbac role=owner / isPlatformOwner) のみ honor される。
// それ以外のユーザーは API 側で無視 → realPlan のレスポンスが返るため悪用不可。
// 実権限 (= requirePlanFeature) は引き続き AsyncLocalStorage 経由で platform admin bypass、
// 一般ユーザーは Subscription DB を見るので変化なし。

import { useAccessPreview } from "@/hooks/useAccessPreview";
import { useWorkLimit, type WorkLimitState } from "@/hooks/useWorkLimit";
import type { PlanTier } from "@/lib/constants/plans";

export interface EffectivePlanInfoState extends WorkLimitState {
  /** UI が使うべきプランティア (= 表示確認モード適用後)。 */
  effectivePlan: PlanTier;
  /** plan / role のどちらかでも preview が適用されているか。 */
  isPreviewing:  boolean;
  /** plan の preview が適用されているか (= 価格・上限表示の preview 判定で使う)。 */
  isPreviewingPlan: boolean;
}

export function useEffectivePlanInfo(oaId: string): EffectivePlanInfoState {
  const preview = useAccessPreview(oaId);
  // 表示確認モード中のみ ?previewPlan を forward。通常モードでは null で実プランを取得。
  const previewPlan = preview.isPreviewingPlan ? preview.previewPlan : null;
  const limit = useWorkLimit(oaId, { previewPlan });

  return {
    ...limit,
    effectivePlan:    preview.effectivePlan,
    isPreviewing:     preview.isPreviewing,
    isPreviewingPlan: preview.isPreviewingPlan,
  };
}
