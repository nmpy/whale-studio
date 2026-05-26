"use client";

// src/components/PlanRequiredCard.tsx
//
// プラン不足で機能ページを開けないときに表示する案内コンポーネント。
//
// 直 URL アクセス時にいきなり 404 を返すのではなく、案内 + 「管理メニューに戻る」
// 導線を出すことで「気付かない遷移」を防ぐ。

import { useSearchParams } from "next/navigation";
import { TLink as Link } from "@/components/TLink";
import {
  HUB_CARD_TO_FEATURE,
  PLAN_LABELS,
  getRequiredPlanForFeature,
  type FeatureKey,
  type PlanTier,
} from "@/lib/constants/plans";
import { withPreviewParams } from "@/lib/access-preview";

interface Props {
  /** OA ID (= 管理メニューへの戻り先ルーティングに使う) */
  oaId: string;
  /** 作品 ID (= 作品配下ページで利用)。OA 直下ページなら未指定で OK */
  workId?: string;
  /** どの機能ページかを示す key (= FEATURE.audience 等)。
   *  card key と機能 key の対応は HUB_CARD_TO_FEATURE 経由でも引ける。 */
  featureKey: FeatureKey;
  /** 現在のプラン (= 表示文言に使う)。不明なら未指定で OK (= "現在のプラン" 表記を出さない) */
  currentPlan?: PlanTier;
  /** カードのタイトル (= 例 "オーディエンス")。未指定なら「この機能」と表示。 */
  featureLabel?: string;
}

export function PlanRequiredCard({ oaId, workId, featureKey, currentPlan, featureLabel }: Props) {
  const searchParams = useSearchParams();
  const requiredPlan = getRequiredPlanForFeature(featureKey);
  const requiredLabel = PLAN_LABELS[requiredPlan];
  // 戻り先: workId があれば作品ハブ、無ければ OA トップ。
  // owner の表示確認モード中は previewPlan / previewRole を持ち越す
  // (= 「Basic で見ると LIFF はグレーアウト」を確認した後、戻った管理メニューでも
  //   Basic 表示を維持するため)。
  const backHref = withPreviewParams(
    workId ? `/oas/${oaId}/works/${workId}` : `/oas/${oaId}`,
    searchParams,
  );

  return (
    <div
      style={{
        maxWidth: 540,
        margin:   "60px auto",
        padding:  "32px 28px",
        background:   "var(--surface)",
        border:       "1px solid var(--border-light)",
        borderRadius: "var(--radius-md)",
        boxShadow:    "var(--shadow-xs)",
        textAlign:    "center",
      }}
    >
      <div style={{
        width: 56, height: 56, borderRadius: "50%",
        background: "#fffbeb", border: "1px solid #fde68a",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        marginBottom: 16,
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: "var(--text-primary)" }}>
        {featureLabel ?? "この機能"}は{requiredLabel}プラン以上で利用できます
      </h2>

      <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 24 }}>
        現在のプランではこの機能を利用できません。
        {currentPlan && (
          <>
            <br />
            現在のプラン: <strong>{PLAN_LABELS[currentPlan]}</strong>
          </>
        )}
      </p>

      <Link
        href={backHref}
        className="btn btn-primary"
        style={{ display: "inline-block", padding: "10px 24px", fontSize: 13 }}
      >
        管理メニューに戻る
      </Link>
    </div>
  );
}
