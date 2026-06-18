"use client";

// src/app/oas/[id]/locations/beacons/[beaconTriggerId]/edit/page.tsx — ビーコントリガー編集

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getAuthHeaders } from "@/lib/api-client";
import { OaBeaconForm, type OaBeaconFormValue, isoToLocalInput, type BeaconActionType } from "../../_oa-beacon-form";
import { InlineWhaleLoader } from "@/components/ui/InlineWhaleLoader";

type TriggerResponse = {
  id: string; name: string; hwid: string; work_id: string | null;
  enabled: boolean; event_types: string; action_type: string;
  action_payload: Record<string, unknown> | null;
  cooldown_seconds: number; once_per_user: boolean; max_triggers_per_user: number | null;
  valid_from: string | null; valid_to: string | null; note: string | null;
};

export default function EditBeaconPage() {
  const params = useParams();
  const oaId = params.id as string;
  const beaconId = params.beaconTriggerId as string;

  const [initial, setInitial] = useState<OaBeaconFormValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/oas/${oaId}/beacons`, { headers: { ...getAuthHeaders() }, cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (!json?.success || !Array.isArray(json.data)) { setError("読み込みに失敗しました"); return; }
        const t = (json.data as TriggerResponse[]).find((x) => x.id === beaconId);
        if (!t) { setError("ビーコントリガーが見つかりません"); return; }
        setInitial({
          id: t.id,
          name: t.name,
          hwid: t.hwid,
          work_id: t.work_id,
          enabled: t.enabled,
          event_types: t.event_types,
          action_type: t.action_type as BeaconActionType,
          action_payload: t.action_payload ?? {},
          cooldown_seconds: t.cooldown_seconds,
          once_per_user: t.once_per_user,
          max_triggers_per_user: t.max_triggers_per_user,
          valid_from: isoToLocalInput(t.valid_from),
          valid_to: isoToLocalInput(t.valid_to),
          note: t.note ?? "",
        });
      } catch {
        if (!cancelled) setError("通信エラーが発生しました");
      }
    })();
    return () => { cancelled = true; };
  }, [oaId, beaconId]);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb
        items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "Beaconチェックイン", href: `/oas/${oaId}/locations/beacons` },
          { label: "編集" },
        ]}
      />
      <h1 className="mb-4 font-round text-[clamp(18px,3.5vw,22px)] font-extrabold tracking-[-0.02em] text-ink">ビーコンを編集</h1>
      {error ? (
        <div className="rounded-card border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</div>
      ) : !initial ? (
        <div className="rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-3"><InlineWhaleLoader padding={0} /></div>
      ) : (
        <OaBeaconForm oaId={oaId} mode="edit" initial={initial} />
      )}
    </div>
  );
}
