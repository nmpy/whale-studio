"use client";

// src/app/oas/[id]/works/[workId]/locations/page.tsx
//
// ロケーションタブハブ — GPS / ビーコン / QR を ?tab=... で切り替える。
// 既存の /locations/new, /locations/[locationId], /locations/print との衝突を避けるため
// query parameter 方式（推奨案A）を採用している。

import { useParams, useSearchParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
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

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb
        items={[
          { label: "OA一覧", href: "/oas" },
          { label: "作品", href: `/oas/${oaId}/works/${workId}` },
          { label: "ロケーション" },
        ]}
      />

      <div style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>ロケーション</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 6, lineHeight: 1.6 }}>
          GPS・ビーコン・QRを使って、現地での到達判定や体験の進行トリガーを管理できます。
        </p>
      </div>

      <LocationTabs oaId={oaId} workId={workId} activeTab={activeTab} />

      {activeTab === "gps"     && <GpsPanel        oaId={oaId} workId={workId} />}
      {activeTab === "beacons" && <BeaconListPanel oaId={oaId} workId={workId} />}
      {activeTab === "qr"      && <QrPanel         oaId={oaId} workId={workId} />}
    </div>
  );
}
