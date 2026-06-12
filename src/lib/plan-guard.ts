// src/lib/plan-guard.ts
//
// サーバ側でプランによる機能制限を強制するための helper 群。
//
// ## 目的
//
// UI 側 (= `src/lib/constants/plans.ts` の `getPlanAccessState`) と同じ判定基準を
// page / API でも適用し、直 URL アクセスや API 直叩きで bypass されないようにする。
//
// ## 役割分担
//
// - `src/lib/constants/plans.ts`     : 定数 + 純関数 (= UI / Server 両方から import 可)
// - `src/lib/plan-guard.ts` (本ファイル): Prisma DB を引いて plan を解決するサーバ用 helper
//
// constants/plans.ts は DB に触れないので `"use client"` でも使える / Edge でも使える。
// 本ファイルは Prisma を import するため Node 専用 (= "use server" 系で呼ばれる前提)。
//
// ## 既存認可との関係
//
// 既存の `withAuth` / `withRole` / `requireRole` は「ユーザー個人の役割 (role)」を見る。
// 本ファイルは「OA / Work が契約しているプラン (= subscription tier)」を見る。
//
// 判定順 (= 推奨):
//   1. withAuth / withRole で認証 + role 認可を通す
//   2. requirePlanFeature で plan 制限を通す
//   3. ハンドラ本体を実行
//
// 既存テストや既存 API 認可ロジックは変更せず、新しい層として加算する形にする。
//
// ## 将来の role / 権限制御 (= client_operator) との分離
//
// 本ファイルは plan の話のみ。client_operator 等の細かい action 制御は
// `src/lib/constants/plans.ts` の `getAccessState` 拡張で対応する。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOaIdFromWorkId } from "@/lib/rbac";
import { planRequired } from "@/lib/api-response";
import { isPlatformOwner } from "@/lib/platform-admin";
import { getCurrentUserId } from "@/lib/user-context";
import {
  PLAN_LABELS,
  PLAN_TIER,
  mapPlanNameToTier,
  getPlanAccessState,
  type PlanTier,
  type FeatureKey,
} from "@/lib/constants/plans";
import { effectiveTierFromSub } from "@/lib/subscription-grant";

/**
 * 現在のリクエストの userId が PLATFORM_ADMIN_USER_IDS に含まれているかを判定する。
 * withAuth / withRole が AsyncLocalStorage に userId を束ねている前提
 * (= `runWithCurrentUserId` 経由)。context 外で呼ばれた場合は false。
 */
function isCurrentUserPlatformAdmin(): boolean {
  const uid = getCurrentUserId();
  return !!uid && isPlatformOwner(uid);
}

// ────────────────────────────────────────────────
// 現在の plan tier を取得する
// ────────────────────────────────────────────────

/**
 * 指定 OA の現在のプランティアを返す。
 *
 * - Subscription 未設定 / DB エラー時は basic にフォールバック (= UI 側と同じ思想)。
 * - Subscription はあるが `status` が "active" / "trialing" 以外 (= past_due / canceled /
 *   unpaid / incomplete / incomplete_expired / paused / 不明) の場合は basic にフォール
 *   バック (= 課金未完了で上位機能が使えるのを防ぐ)。
 *   UI 側の PlanCard はそのまま status を表示するため、表示と権限制御は別経路。
 */
export async function getCurrentPlanTierForOa(oaId: string): Promise<PlanTier> {
  // platform admin (PLATFORM_ADMIN_USER_IDS) は常に最上位プラン扱い (= 機能制限を一切受けない)。
  // Subscription を引かずに早期 return することで DB クエリも省略できる。
  if (isCurrentUserPlatformAdmin()) return PLAN_TIER.pro;

  if (!oaId) return mapPlanNameToTier(null);
  try {
    const sub = await prisma.subscription.findUnique({
      where:   { oaId },
      select:  { status: true, grantType: true, trialEndsAt: true, plan: { select: { name: true } } },
    });
    if (!sub) return mapPlanNameToTier(null);
    // β版 / トライアルの実効ティアを純ロジックで判定 (= UI と同じ subscription-grant を共有):
    //   - grantType="beta"  → 無期限・plan(pro)=Pro Max 相当
    //   - grantType="trial" → trialEndsAt 内は plan(pro)、失効後は basic
    //   - それ以外          → status が full access のとき plan の tier、それ以外 basic
    return effectiveTierFromSub({
      status:      sub.status,
      grantType:   sub.grantType,
      trialEndsAt: sub.trialEndsAt,
      planName:    sub.plan?.name ?? null,
    });
  } catch (err) {
    // DB エラー時は最低プラン扱い (= 機能を不用意に開放しない)
    console.error("[plan-guard] getCurrentPlanTierForOa failed:", err);
    return mapPlanNameToTier(null);
  }
}

/**
 * 指定 Work の現在のプランティアを返す (= work → OA → Subscription を解決)。
 * work が存在しない / OA 取れない場合は basic フォールバック。
 */
export async function getCurrentPlanTierForWork(workId: string): Promise<PlanTier> {
  if (!workId) return mapPlanNameToTier(null);
  const oaId = await getOaIdFromWorkId(workId);
  if (!oaId) return mapPlanNameToTier(null);
  return getCurrentPlanTierForOa(oaId);
}

// ────────────────────────────────────────────────
// API guard
// ────────────────────────────────────────────────

/** plan check の判定結果。withRole 系と shape を揃える。 */
export type PlanGuardResult =
  | { ok: true;  plan: PlanTier }
  | { ok: false; response: NextResponse };

/**
 * API ハンドラから呼ぶ plan check。
 *
 * - `oaId` を直接渡せばその OA の plan を見る
 * - `workId` を渡せば work → OA → plan を解決する (= どちらか必須)
 * - featureKey が plan で許可されていなければ 403 + PLAN_REQUIRED を返す
 *
 * 使い方:
 *   const guard = await requirePlanFeature({ workId, featureKey: FEATURE.location });
 *   if (!guard.ok) return guard.response;
 *   // ... handler 本体
 */
export async function requirePlanFeature(args: {
  workId?:    string | null;
  oaId?:      string | null;
  featureKey: FeatureKey;
}): Promise<PlanGuardResult> {
  const { workId, oaId: directOaId, featureKey } = args;

  // どちらか必須。両方未指定なら設計バグ扱い (= 安全側で 403)。
  if (!workId && !directOaId) {
    console.warn("[plan-guard] requirePlanFeature called without workId or oaId");
    return {
      ok: false,
      response: planRequired({
        requiredPlan:      "pro",
        requiredPlanLabel: PLAN_LABELS.pro,
        message:           "プラン判定対象が指定されていません",
      }),
    };
  }

  const plan = directOaId
    ? await getCurrentPlanTierForOa(directOaId)
    : await getCurrentPlanTierForWork(workId!);

  const state = getPlanAccessState({ plan, featureKey });
  if (state.allowed) return { ok: true, plan };

  return {
    ok: false,
    response: planRequired({
      requiredPlan:      state.requiredPlan,
      requiredPlanLabel: state.requiredPlanLabel,
      message:           state.message,
    }),
  };
}
