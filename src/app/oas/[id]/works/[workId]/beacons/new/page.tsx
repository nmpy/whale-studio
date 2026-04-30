"use client";

// src/app/oas/[id]/works/[workId]/beacons/new/page.tsx

import { useParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import BeaconForm from "../_form";

export default function NewBeaconPage() {
  const params = useParams();
  const oaId = params.id as string;
  const workId = params.workId as string;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb
        items={[
          { label: "OA一覧", href: "/oas" },
          { label: "作品", href: `/oas/${oaId}/works/${workId}` },
          { label: "ビーコン", href: `/oas/${oaId}/works/${workId}/beacons` },
          { label: "新規追加" },
        ]}
      />
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 18 }}>ビーコントリガーを追加</h1>
      <BeaconForm
        oaId={oaId}
        workId={workId}
        mode="create"
        initial={{
          name: "",
          hwid: "",
          enabled: true,
          event_types: "enter",
          cooldown_seconds: 300,
          action_type: "send_message",
          action_payload: { text: "" },
        }}
      />
    </div>
  );
}
