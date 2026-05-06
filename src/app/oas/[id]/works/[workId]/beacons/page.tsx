"use client";

// src/app/oas/[id]/works/[workId]/beacons/page.tsx
//
// LINE Beacon トリガー一覧（後方互換ルート）。
// 内容は共通の BeaconListPanel に寄せ、上部にロケーションタブを表示して
// /locations?tab=beacons と同じ情報設計でアクセスできるようにしている。

import { useParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { LocationTabs } from "../locations/_tabs";
import BeaconListPanel from "./_beacon-list-panel";

export default function BeaconsPage() {
  const params = useParams();
  const oaId = params.id as string;
  const workId = params.workId as string;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb
        items={[
          { label: "OA一覧", href: "/oas" },
          { label: "作品", href: `/oas/${oaId}/works/${workId}` },
          { label: "ロケーション", href: `/oas/${oaId}/works/${workId}/locations` },
          { label: "ビーコン" },
        ]}
      />

      <div style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>ロケーション</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 6, lineHeight: 1.6 }}>
          GPS・ビーコン・QRを使って、現地での到達判定や体験の進行トリガーを管理できます。
        </p>
      </div>

      <LocationTabs oaId={oaId} workId={workId} activeTab="beacons" />

      <BeaconListPanel oaId={oaId} workId={workId} />
    </div>
  );
}
