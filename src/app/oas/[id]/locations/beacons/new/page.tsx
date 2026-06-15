"use client";

// src/app/oas/[id]/locations/beacons/new/page.tsx — ビーコントリガー新規作成
// ?workId=... があれば「紐づける作品」の初期値に引き継ぐ。

import { useParams, useSearchParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { OaBeaconForm, type OaBeaconFormValue } from "../_oa-beacon-form";

export default function NewBeaconPage() {
  const params = useParams();
  const oaId = params.id as string;
  const workId = useSearchParams().get("workId");

  const initial: OaBeaconFormValue = {
    name: "",
    hwid: "",
    work_id: workId || null,
    enabled: true,
    event_types: "enter",
    action_type: "send_message",
    action_payload: { text: "" },
    cooldown_seconds: 300,
    once_per_user: false,
    max_triggers_per_user: null,
    valid_from: "",
    valid_to: "",
    note: "",
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb
        items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "Beaconチェックイン", href: `/oas/${oaId}/locations/beacons` },
          { label: "新規作成" },
        ]}
      />
      <h1 className="mb-4 font-round text-[clamp(18px,3.5vw,22px)] font-extrabold tracking-[-0.02em] text-ink">ビーコンを追加</h1>
      <OaBeaconForm oaId={oaId} mode="create" initial={initial} />
    </div>
  );
}
