"use client";

// src/app/oas/[id]/works/[workId]/locations/page.tsx
//
// ロケーションタブハブ — GPS / ビーコン / QR を ?tab=... で切り替える。
// 既存の /locations/new, /locations/[locationId], /locations/print との衝突を避けるため
// query parameter 方式（推奨案A）を採用している。

import { useParams, useSearchParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useAccessPreview } from "@/hooks/useAccessPreview";
import { PlanRequiredCard } from "@/components/PlanRequiredCard";
import { FEATURE, getPlanAccessState } from "@/lib/constants/plans";
import { LocationTabs, resolveLocationTab } from "./_tabs";
import GpsPanel from "./_gps-panel";
import QrPanel from "./_qr-panel";
import BeaconListPanel from "../beacons/_beacon-list-panel";

export default function LocationsHubPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const oaId = params.id as string;
  const workId = params.workId as string;

  const activeTab = resolveLocationTab(searchParams.get("tab"));

  // プラン制限: location は Pro 以上が必要。
  // owner が「表示確認モード」で他プランを選んでいる場合は effectivePlan を使う。
  const { effectivePlan: planTier, loading: planLoading } = useAccessPreview(oaId);
  const planAccess = getPlanAccessState({ plan: planTier, featureKey: FEATURE.location });

  // 直 URL アクセス時にここで遮断する。loading 中はチラつき防止で素通り。
  if (!planLoading && !planAccess.allowed) {
    return (
      <PlanRequiredCard
        oaId={oaId}
        workId={workId}
        featureKey={FEATURE.location}
        currentPlan={planTier}
        featureLabel="ロケーション"
      />
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb
        items={[
          { label: "OA一覧", href: "/oas" },
          { label: "作品", href: `/oas/${oaId}/works/${workId}` },
          { label: "現地トリガー" },
        ]}
      />

      <div style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>現地トリガー</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 6, lineHeight: 1.6 }}>
          GPS・ビーコン・QRを使って、現地での到達判定や体験の進行トリガーを管理できます。
        </p>
      </div>

      {/* ── 移行バナー: ロケーション管理は OA レベルに集約された ── */}
      <div
        role="status"
        style={{
          display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap",
          background: "#e9f8ef", border: "1px solid rgba(34,197,94,.3)", borderRadius: 12,
          padding: "14px 16px", marginBottom: 16,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#0f7a3d", marginBottom: 4 }}>
            現地トリガー管理に移動しました
          </p>
          <p style={{ fontSize: 12, color: "#33403a", lineHeight: 1.6 }}>
            GPS / QR / Beacon は、現地の地点やチェックイン方法に紐づく機能です。ロケーション管理画面でまとめて確認・編集できます。
          </p>
        </div>
        <a
          href={`/oas/${oaId}/locations?workId=${workId}`}
          style={{
            flexShrink: 0, padding: "9px 18px", background: "#22c55e", color: "#fff",
            borderRadius: 999, fontSize: 13, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap",
          }}
        >
          ロケーション管理を開く →
        </a>
      </div>

      <LocationTabs oaId={oaId} workId={workId} activeTab={activeTab} />

      {activeTab === "gps"     && <GpsPanel        oaId={oaId} workId={workId} />}
      {activeTab === "beacons" && <BeaconListPanel oaId={oaId} workId={workId} />}
      {activeTab === "qr"      && <QrPanel         oaId={oaId} workId={workId} />}
    </div>
  );
}
