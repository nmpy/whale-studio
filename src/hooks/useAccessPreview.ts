"use client";

// src/hooks/useAccessPreview.ts
//
// 「表示確認モード (= access preview)」を画面側で扱う共通フック。
//
// 戻り値:
//   - realPlan / realRole : DB に保存されている実際の値
//   - previewPlan / previewRole : URL ?previewPlan ?previewRole から抽出した値 (= 不正値は null)
//   - effectivePlan / effectiveRole : UI / page guard が使うべき値
//       (= owner かつ preview 指定があれば preview、そうでなければ real)
//   - canUsePreviewMode : 現在のユーザーが preview を使えるか (= isOwner)
//   - isPreviewing : preview が実際に適用されているか
//
// このフックは UI 側だけで使う。API では絶対に preview を採用しないこと。

import { useSearchParams } from "next/navigation";
import { useWorkLimit } from "@/hooks/useWorkLimit";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { mapPlanNameToTier, type PlanTier } from "@/lib/constants/plans";
import {
  parsePreviewPlan,
  parsePreviewRole,
  getEffectivePlan,
  getEffectiveRole,
  type PreviewRole,
} from "@/lib/access-preview";

/** WorkspaceRole の実体型を access-preview に伝えるためのエイリアス */
export type RealRole = "owner" | "admin" | "editor" | "tester" | "viewer" | null;

export interface AccessPreviewState {
  realPlan:           PlanTier;
  realRole:           RealRole;
  previewPlan:        PlanTier | null;
  previewRole:        PreviewRole | null;
  effectivePlan:      PlanTier;
  effectiveRole:      RealRole | PreviewRole;
  canUsePreviewMode:  boolean;
  isPreviewingPlan:   boolean;
  isPreviewingRole:   boolean;
  /** plan / role のどちらかでも preview が適用されているか (= バッジ表示判定) */
  isPreviewing:       boolean;
  /** plan-info / role がまだ取得中か */
  loading:            boolean;
}

/**
 * 指定 OA における preview state を返す。
 *
 * - 内部で useSearchParams を呼ぶため client component 専用。
 * - 内部で useWorkspaceRole / useWorkLimit を呼ぶため、SWR と同じく
 *   ローディング中は real 値が null/basic で返る場合がある。
 *
 * @param oaId 現在の OA ID。OA 配下でない画面では空文字を渡してもクラッシュしない。
 */
export function useAccessPreview(oaId: string): AccessPreviewState {
  const searchParams = useSearchParams();
  const { role, isOwner, loading: roleLoading } = useWorkspaceRole(oaId);
  const { planName, loading: planLoading } = useWorkLimit(oaId);

  const realPlan = mapPlanNameToTier(planName);
  const realRole = (role ?? null) as RealRole;
  const previewPlan = parsePreviewPlan(searchParams.get("previewPlan"));
  const previewRole = parsePreviewRole(searchParams.get("previewRole"));
  const canUsePreviewMode = isOwner;

  const effectivePlan = getEffectivePlan({
    realPlan,
    previewPlan,
    canUsePreviewMode,
  });
  const effectiveRole = getEffectiveRole<RealRole>({
    realRole,
    previewRole,
    canUsePreviewMode,
  });

  const isPreviewingPlan = canUsePreviewMode && previewPlan !== null && previewPlan !== realPlan;
  const isPreviewingRole = canUsePreviewMode && previewRole !== null && previewRole !== realRole;

  return {
    realPlan,
    realRole,
    previewPlan,
    previewRole,
    effectivePlan,
    effectiveRole,
    canUsePreviewMode,
    isPreviewingPlan,
    isPreviewingRole,
    isPreviewing: isPreviewingPlan || isPreviewingRole,
    loading: roleLoading || planLoading,
  };
}
