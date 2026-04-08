"use client";

// src/app/oas/[id]/works/[workId]/locations/_form.tsx
// ロケーション作成・編集共通フォーム

import { useEffect, useState } from "react";
import { transitionApi, getDevToken } from "@/lib/api-client";
import type { TransitionWithPhases } from "@/types";

interface LocationFormProps {
  onSubmit: (data: Record<string, unknown>) => void;
  saving: boolean;
  workId: string;
  defaultValues?: {
    name: string;
    description: string;
    beacon_uuid: string;
    beacon_major: number | null;
    beacon_minor: number | null;
    cooldown_seconds: number;
    transition_id: string;
    set_flags: string;
    is_active: boolean;
  };
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" };
const groupStyle: React.CSSProperties = { marginBottom: 16 };
const helpStyle: React.CSSProperties = { fontSize: 12, color: "#9ca3af", marginTop: 2 };

function validateJson(str: string): { valid: boolean; message?: string } {
  if (!str.trim() || str.trim() === "{}") return { valid: true };
  try {
    const v = JSON.parse(str);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return { valid: false, message: "JSON オブジェクト ({...}) である必要があります" };
    return { valid: true };
  } catch {
    return { valid: false, message: "JSON の構文が正しくありません" };
  }
}

export function LocationForm({ onSubmit, saving, workId, defaultValues }: LocationFormProps) {
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [description, setDescription] = useState(defaultValues?.description ?? "");
  const [beaconUuid, setBeaconUuid] = useState(defaultValues?.beacon_uuid ?? "");
  const [beaconMajor, setBeaconMajor] = useState(defaultValues?.beacon_major?.toString() ?? "");
  const [beaconMinor, setBeaconMinor] = useState(defaultValues?.beacon_minor?.toString() ?? "");
  const [cooldownSeconds, setCooldownSeconds] = useState(defaultValues?.cooldown_seconds?.toString() ?? "300");
  const [transitionId, setTransitionId] = useState(defaultValues?.transition_id ?? "");
  const [setFlags, setSetFlags] = useState(defaultValues?.set_flags ?? "{}");
  const [isActive, setIsActive] = useState(defaultValues?.is_active ?? true);
  const [showBeacon, setShowBeacon] = useState(!!defaultValues?.beacon_uuid);

  const [transitions, setTransitions] = useState<TransitionWithPhases[]>([]);

  // JSON バリデーション（リアルタイム）
  const jsonCheck = validateJson(setFlags);

  useEffect(() => {
    (async () => {
      try {
        const data = await transitionApi.listByWork(getDevToken(), workId);
        setTransitions(data);
      } catch { /* ignore */ }
    })();
  }, [workId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!jsonCheck.valid) return;

    const data: Record<string, unknown> = {
      name,
      description: description || undefined,
      cooldown_seconds: Number(cooldownSeconds) || 300,
      transition_id: transitionId || (defaultValues ? null : undefined),
      set_flags: setFlags.trim() || "{}",
      is_active: isActive,
    };
    if (showBeacon) {
      data.beacon_uuid = beaconUuid || (defaultValues ? null : undefined);
      data.beacon_major = beaconMajor ? Number(beaconMajor) : (defaultValues ? null : undefined);
      data.beacon_minor = beaconMinor ? Number(beaconMinor) : (defaultValues ? null : undefined);
    } else if (defaultValues) {
      data.beacon_uuid = null;
      data.beacon_major = null;
      data.beacon_minor = null;
    }
    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={groupStyle}>
        <label style={labelStyle}>ロケーション名 *</label>
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 受付ロビー" required />
      </div>

      <div style={groupStyle}>
        <label style={labelStyle}>説明</label>
        <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="ロケーションの説明（任意）" />
      </div>

      {/* ビーコン設定 */}
      <div style={{ marginBottom: 16, border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
        <button
          type="button"
          onClick={() => setShowBeacon(!showBeacon)}
          style={{
            width: "100%", padding: "10px 14px", background: "#f9fafb",
            border: "none", textAlign: "left", cursor: "pointer",
            fontSize: 13, fontWeight: 600, color: "#374151",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}
        >
          <span>Bluetooth ビーコン設定 <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af" }}>（任意）</span></span>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>{showBeacon ? "▲" : "▼"}</span>
        </button>
        {showBeacon && (
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={labelStyle}>UUID <span style={{ fontWeight: 400, color: "#9ca3af" }}>�� ビーコン機器の識別子</span></label>
              <input style={inputStyle} value={beaconUuid} onChange={(e) => setBeaconUuid(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Major <span style={{ fontWeight: 400, color: "#9ca3af" }}>— グループ番号</span></label>
                <input style={inputStyle} type="number" min="0" max="65535" value={beaconMajor} onChange={(e) => setBeaconMajor(e.target.value)} placeholder="0-65535" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Minor <span style={{ fontWeight: 400, color: "#9ca3af" }}>— 個体番号</span></label>
                <input style={inputStyle} type="number" min="0" max="65535" value={beaconMinor} onChange={(e) => setBeaconMinor(e.target.value)} placeholder="0-65535" />
              </div>
            </div>
            <p style={helpStyle}>Beacon 自動検知機能で使用します。未入力でも QR コード経由のチェックインは利用できます。</p>
          </div>
        )}
      </div>

      <div style={groupStyle}>
        <label style={labelStyle}>クールダウン（秒）</label>
        <input style={inputStyle} type="number" min="0" max="86400" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value)} />
        <p style={helpStyle}>同一ユーザーが連続チェックインできるまでの待機時間（デフォルト: 300秒 = 5分）</p>
      </div>

      <div style={groupStyle}>
        <label style={labelStyle}>チェックイン時に発火する遷移</label>
        <select style={inputStyle} value={transitionId} onChange={(e) => setTransitionId(e.target.value)}>
          <option value="">なし</option>
          {transitions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} → {t.to_phase?.name ?? "?"}
            </option>
          ))}
        </select>
        <p style={helpStyle}>チェックイン時にユーザーを自動的に次のフェーズに遷移させます。遷移元フェーズが現在フェーズと一致する場合のみ発火します。</p>
      </div>

      <div style={groupStyle}>
        <label style={labelStyle}>チェックイン時に設定するフラグ（JSON）</label>
        <textarea
          style={{
            ...inputStyle,
            fontFamily: "monospace", fontSize: 13, minHeight: 60,
            borderColor: !jsonCheck.valid ? "#fca5a5" : "#d1d5db",
          }}
          value={setFlags}
          onChange={(e) => setSetFlags(e.target.value)}
          placeholder='{"visited_lobby": true}'
        />
        {!jsonCheck.valid && (
          <p style={{ fontSize: 12, color: "#dc2626", marginTop: 2 }}>{jsonCheck.message}</p>
        )}
        <p style={helpStyle}>UserProgress.flags にマージされる JSON オブジェクト。遷移の flagCondition と組み合わせて分岐���使えます。</p>
      </div>

      <div style={{ ...groupStyle, display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" id="is_active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ width: 16, height: 16 }} />
        <label htmlFor="is_active" style={{ fontSize: 14, fontWeight: 500, color: "#374151" }}>有効</label>
      </div>

      <button
        type="submit"
        disabled={saving || !name.trim() || !jsonCheck.valid}
        style={{
          width: "100%", padding: "12px",
          background: (saving || !jsonCheck.valid) ? "#93c5fd" : "#2563eb",
          color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600,
          cursor: (saving || !jsonCheck.valid) ? "not-allowed" : "pointer",
        }}
      >
        {saving ? "保存中..." : defaultValues ? "更新" : "作成"}
      </button>
    </form>
  );
}
