"use client";

// src/app/oas/[id]/locations/beacons/_test-fire-modal.tsx
// 疑似発火テスト モーダル（platform admin 専用）。
// 本番 Webhook と同じ handleBeaconEvent / resolver / sender を通す。
// 誤爆防止のため lineUserId 必須。replyToken は無いため push 送信になる。

import { useState } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import { Button } from "@/components/shared";
import { beaconOutcomeLabel } from "@/lib/beacon-utils";

const inputCls =
  "w-full rounded-field border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-brand";

export function TestFireModal({
  oaId,
  trigger,
  onClose,
}: {
  oaId: string;
  trigger: { id: string; name: string; hwid: string };
  onClose: () => void;
}) {
  const [lineUserId, setLineUserId] = useState("");
  const [beaconType, setBeaconType] = useState("enter");
  const [dm, setDm] = useState("");
  const [ignoreLimits, setIgnoreLimits] = useState(false);
  const [firing, setFiring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; reason: string | null } | null>(null);

  async function fire() {
    setError(null);
    setResult(null);
    if (!lineUserId.trim()) { setError("lineUserId は必須です"); return; }
    setFiring(true);
    try {
      const res = await fetch(`/api/oas/${oaId}/beacons/test-fire`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          beacon_trigger_id: trigger.id,
          line_user_id: lineUserId.trim(),
          beacon_type: beaconType,
          dm: dm.trim() || null,
          ignore_limits: ignoreLimits,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(json?.error ?? `テスト発火に失敗しました (${res.status})`); setFiring(false); return; }
      setResult({ status: json.data.status, reason: json.data.reason ?? null });
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setFiring(false);
    }
  }

  const outcome = result ? beaconOutcomeLabel(result.status) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-[15px] font-bold text-ink">テスト発火</h3>
        <p className="mb-4 text-[12px] leading-[1.6] text-ink-3">
          「{trigger.name}」（hwid: <span className="font-mono">{trigger.hwid}</span>）を疑似発火します。
          指定した lineUserId に <strong>実際に push 送信されます</strong>。本番ユーザーを誤爆しないようご注意ください。
        </p>

        <div className="mb-3">
          <label className="mb-1 block text-[12px] font-semibold text-ink">lineUserId<span className="ml-1 text-danger">*</span></label>
          <input className={`${inputCls} font-mono`} value={lineUserId} onChange={(e) => setLineUserId(e.target.value)} placeholder="U xxxxxxxx..." />
        </div>

        <div className="mb-3 flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-[12px] font-semibold text-ink">beaconType</label>
            <select className={inputCls} value={beaconType} onChange={(e) => setBeaconType(e.target.value)}>
              <option value="enter">enter</option>
              <option value="stay">stay</option>
              <option value="banner">banner</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-[12px] font-semibold text-ink">dm（任意）</label>
            <input className={inputCls} value={dm} onChange={(e) => setDm(e.target.value)} placeholder="device message" />
          </div>
        </div>

        <label className="mb-4 flex items-center gap-2 text-[12px] text-ink">
          <input type="checkbox" checked={ignoreLimits} onChange={(e) => setIgnoreLimits(e.target.checked)} />
          制限を無視して送信（クールダウン / 1回限り / 上限を無視）
        </label>

        {error && <div className="mb-3 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</div>}
        {outcome && (
          <div className={`mb-3 rounded-field border px-3 py-2 text-[12px] ${outcome.kind === "sent" ? "border-brand/30 bg-brand-soft text-brand-ink" : outcome.kind === "failed" ? "border-danger/30 bg-danger-soft text-danger" : "border-line bg-bg text-ink-2"}`}>
            結果: <strong>{outcome.label}</strong>（{result?.status}）{result?.reason ? ` — ${result.reason}` : ""}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>閉じる</Button>
          <Button type="button" variant="primary" size="sm" onClick={fire} disabled={firing}>{firing ? "発火中…" : "テスト発火する"}</Button>
        </div>
      </div>
    </div>
  );
}
