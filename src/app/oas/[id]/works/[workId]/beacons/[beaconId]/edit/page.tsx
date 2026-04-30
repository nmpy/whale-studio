"use client";

// src/app/oas/[id]/works/[workId]/beacons/[beaconId]/edit/page.tsx

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getAuthHeaders } from "@/lib/api-client";
import BeaconForm, { type BeaconFormValue } from "../../_form";

type BeaconResponse = {
  id: string;
  name: string;
  hwid: string;
  enabled: boolean;
  event_types: string;
  cooldown_seconds: number;
  action_type: BeaconFormValue["action_type"];
  action_payload: Record<string, unknown> | null;
};

export default function EditBeaconPage() {
  const params = useParams();
  const oaId = params.id as string;
  const workId = params.workId as string;
  const beaconId = params.beaconId as string;

  const [beacon, setBeacon] = useState<BeaconResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/works/${workId}/beacons`, {
      headers: getAuthHeaders(),
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) {
          setError(json.error?.message ?? "読み込みに失敗しました");
          return;
        }
        const found = (json.data as BeaconResponse[]).find((b) => b.id === beaconId);
        if (!found) {
          setError("該当のビーコントリガーが見つかりません");
          return;
        }
        setBeacon(found);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [workId, beaconId]);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb
        items={[
          { label: "OA一覧", href: "/oas" },
          { label: "作品", href: `/oas/${oaId}/works/${workId}` },
          { label: "ビーコン", href: `/oas/${oaId}/works/${workId}/beacons` },
          { label: "編集" },
        ]}
      />
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 18 }}>ビーコントリガーを編集</h1>

      {error && (
        <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>
          {error}
        </div>
      )}

      {!error && !beacon && <div style={{ color: "#6b7280", fontSize: 13 }}>読み込み中…</div>}

      {beacon && (
        <BeaconForm
          oaId={oaId}
          workId={workId}
          mode="edit"
          initial={{
            id: beacon.id,
            name: beacon.name,
            hwid: beacon.hwid,
            enabled: beacon.enabled,
            event_types: beacon.event_types,
            cooldown_seconds: beacon.cooldown_seconds,
            action_type: beacon.action_type,
            action_payload: beacon.action_payload,
          }}
        />
      )}
    </div>
  );
}
