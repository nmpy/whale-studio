"use client";

// src/app/oas/[id]/locations/beacons/_oa-beacon-list.tsx
// OA レベルのビーコントリガー一覧。OA 共通 + 全作品のトリガーを 1 画面で表示する。
// 各行: 有効/無効トグル・編集・ログ・テスト発火（platform admin のみ）。

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getAuthHeaders } from "@/lib/api-client";
import { Button, buttonClass } from "@/components/shared";
import { beaconOutcomeLabel } from "@/lib/beacon-utils";
import { TestFireModal } from "./_test-fire-modal";
import { InlineWhaleLoader } from "@/components/ui/InlineWhaleLoader";

type Trigger = {
  id: string;
  name: string;
  hwid: string;
  work_id: string | null;
  work_title?: string | null;
  enabled: boolean;
  event_types: string;
  action_type: string;
  cooldown_seconds: number;
  once_per_user: boolean;
  max_triggers_per_user: number | null;
  valid_from: string | null;
  valid_to: string | null;
  last_event_at: string | null;
  last_action_status: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  message: "メッセージ送信",
  send_message: "テキスト送信",
  destination: "遷移先送信",
  noop: "ログのみ",
};

export function OaBeaconList({
  oaId,
  workIdFilter,
  readOnly,
  isPlatformAdmin,
}: {
  oaId: string;
  workIdFilter: string | null;
  readOnly: boolean;
  isPlatformAdmin: boolean;
}) {
  const [triggers, setTriggers] = useState<Trigger[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [testTarget, setTestTarget] = useState<Trigger | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/oas/${oaId}/beacons`, { headers: { ...getAuthHeaders() }, cache: "no-store" });
      const json = await res.json();
      if (!json?.success) { setError(json?.error ?? "読み込みに失敗しました"); return; }
      setTriggers(json.data as Trigger[]);
    } catch {
      setError("通信エラーが発生しました");
    }
  }, [oaId]);

  useEffect(() => { load(); }, [load]);

  async function toggleEnabled(t: Trigger) {
    setTogglingId(t.id);
    try {
      const res = await fetch(`/api/oas/${oaId}/beacons/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ enabled: !t.enabled }),
      });
      if (res.ok) {
        setTriggers((prev) => prev?.map((x) => (x.id === t.id ? { ...x, enabled: !x.enabled } : x)) ?? null);
      }
    } finally {
      setTogglingId(null);
    }
  }

  if (error) {
    return <div className="rounded-card border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</div>;
  }
  if (triggers === null) {
    return <div className="rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-3"><InlineWhaleLoader padding={0} /></div>;
  }

  const visible = workIdFilter
    ? triggers.filter((t) => t.work_id === workIdFilter || t.work_id === null)
    : triggers;

  return (
    <div>
      {workIdFilter && (
        <div className="mb-3 flex items-center justify-between rounded-field border border-line bg-brand-mist px-3 py-2 text-[12px] text-ink-2">
          <span>この作品に紐づくトリガー + OA 共通トリガーを表示中です。</span>
          <Link href={`/oas/${oaId}/locations/beacons`} className="font-semibold text-brand-ink underline">絞り込み解除</Link>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-bg px-4 py-10 text-center">
          <div className="mb-2 text-[28px]">📡</div>
          <p className="text-[13px] text-ink-3">ビーコントリガーがまだありません。</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {visible.map((t) => {
            const outcome = t.last_action_status ? beaconOutcomeLabel(t.last_action_status) : null;
            return (
              <div key={t.id} className="rounded-card border border-line bg-surface px-4 py-3.5">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-bold text-ink">{t.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${t.work_id ? "bg-brand-soft text-brand-ink" : "bg-line/70 text-ink-3"}`}>
                        {t.work_id ? (t.work_title ?? "作品") : "OA 共通"}
                      </span>
                      {!t.enabled && <span className="rounded-full bg-line/70 px-2 py-0.5 text-[10px] font-semibold text-ink-3">無効</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-3">
                      <span className="font-mono">{t.hwid}</span>
                      <span>·</span>
                      <span>{ACTION_LABEL[t.action_type] ?? t.action_type}</span>
                      {t.once_per_user && <span>· 1回限り</span>}
                      {t.max_triggers_per_user != null && <span>· 上限{t.max_triggers_per_user}回</span>}
                      {outcome && <span>· 直近: {outcome.label}</span>}
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => toggleEnabled(t)}
                        disabled={togglingId === t.id}
                        className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${t.enabled ? "bg-brand-soft text-brand-ink hover:bg-brand/15" : "bg-line/60 text-ink-3 hover:bg-line"}`}
                      >
                        {t.enabled ? "有効" : "無効"}
                      </button>
                    )}
                    {isPlatformAdmin && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setTestTarget(t)}>テスト発火</Button>
                    )}
                    <Link href={`/oas/${oaId}/locations/beacons/logs?hwid=${encodeURIComponent(t.hwid)}`} className={buttonClass({ variant: "ghost", size: "sm" })}>ログ</Link>
                    {!readOnly && (
                      <Link href={`/oas/${oaId}/locations/beacons/${t.id}/edit`} className={buttonClass({ variant: "ghost", size: "sm" })}>編集</Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {testTarget && (
        <TestFireModal
          oaId={oaId}
          trigger={{ id: testTarget.id, name: testTarget.name, hwid: testTarget.hwid }}
          onClose={() => { setTestTarget(null); load(); }}
        />
      )}
    </div>
  );
}
