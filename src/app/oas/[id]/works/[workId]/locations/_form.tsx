"use client";

// src/app/oas/[id]/works/[workId]/locations/_form.tsx
// ロケーション作成・編集共通フォーム（GPS + スタンプ対応）

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { transitionApi, getDevToken } from "@/lib/api-client";
import type { TransitionWithPhases } from "@/types";

// Leaflet は SSR 非対応のため dynamic import
const LocationMapPicker = dynamic(() => import("@/components/LocationMapPicker"), { ssr: false });

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
    latitude: number | null;
    longitude: number | null;
    radius_meters: number | null;
    checkin_mode: string;
    cooldown_seconds: number;
    transition_id: string;
    set_flags: string;
    is_active: boolean;
    stamp_enabled: boolean;
    stamp_label: string;
    stamp_order: number | null;
  };
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, outline: "none", boxSizing: "border-box" };
const groupStyle: React.CSSProperties = { marginBottom: 16 };
const helpStyle: React.CSSProperties = { fontSize: 12, color: "#9ca3af", marginTop: 2 };
const subLabel: React.CSSProperties = { fontWeight: 400, color: "#9ca3af" };

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

function CollapsibleSection({ title, subtitle, open, onToggle, children }: {
  title: string; subtitle?: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16, border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
      <button
        type="button" onClick={onToggle}
        style={{
          width: "100%", padding: "10px 14px", background: "#f9fafb", border: "none",
          textAlign: "left", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <span>{title} {subtitle && <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af" }}>（{subtitle}）</span>}</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>}
    </div>
  );
}

export function LocationForm({ onSubmit, saving, workId, defaultValues }: LocationFormProps) {
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [description, setDescription] = useState(defaultValues?.description ?? "");
  // Beacon
  const [beaconUuid, setBeaconUuid] = useState(defaultValues?.beacon_uuid ?? "");
  const [beaconMajor, setBeaconMajor] = useState(defaultValues?.beacon_major?.toString() ?? "");
  const [beaconMinor, setBeaconMinor] = useState(defaultValues?.beacon_minor?.toString() ?? "");
  const [showBeacon, setShowBeacon] = useState(!!defaultValues?.beacon_uuid);
  // Checkin mode + GPS
  const [checkinMode, setCheckinMode] = useState(defaultValues?.checkin_mode ?? "qr_only");
  const needsGps = checkinMode === "gps_only" || checkinMode === "qr_and_gps";
  const [latitude, setLatitude] = useState(defaultValues?.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(defaultValues?.longitude?.toString() ?? "");
  const [radiusMeters, setRadiusMeters] = useState(defaultValues?.radius_meters?.toString() ?? "50");
  // Core
  const [cooldownSeconds, setCooldownSeconds] = useState(defaultValues?.cooldown_seconds?.toString() ?? "300");
  const [transitionId, setTransitionId] = useState(defaultValues?.transition_id ?? "");
  const [setFlags, setSetFlags] = useState(defaultValues?.set_flags ?? "{}");
  const [isActive, setIsActive] = useState(defaultValues?.is_active ?? true);
  // Stamp
  const [stampEnabled, setStampEnabled] = useState(defaultValues?.stamp_enabled ?? true);
  const [stampLabel, setStampLabel] = useState(defaultValues?.stamp_label ?? "");
  const [stampOrder, setStampOrder] = useState(defaultValues?.stamp_order?.toString() ?? "");

  const [transitions, setTransitions] = useState<TransitionWithPhases[]>([]);
  const jsonCheck = validateJson(setFlags);

  const radiusNum = Number(radiusMeters);
  const radiusWarning = radiusNum > 0 && radiusNum < 10 ? "半径が非常に小さいです。GPS誤差を考慮して20m以上を推奨します。"
    : radiusNum > 1000 ? "半径が非常に大きいです。意図どおりか確認してください。"
    : null;

  // GPS系モード時に座標・半径が揃っているか
  const gpsIncomplete = needsGps && (!latitude || !longitude || !radiusMeters);
  const latNum = Number(latitude);
  const lngNum = Number(longitude);
  const latInvalid = latitude !== "" && (isNaN(latNum) || latNum < -90 || latNum > 90);
  const lngInvalid = longitude !== "" && (isNaN(lngNum) || lngNum < -180 || lngNum > 180);

  // 地図クリック/ドラッグ時のコールバック
  const handleMapLocationChange = useCallback((lat: number, lng: number) => {
    setLatitude(lat.toFixed(6));
    setLongitude(lng.toFixed(6));
  }, []);

  useEffect(() => {
    (async () => {
      try { setTransitions(await transitionApi.listByWork(getDevToken(), workId)); } catch { /* ignore */ }
    })();
  }, [workId]);

  const canSubmit = name.trim() && jsonCheck.valid && !gpsIncomplete && !latInvalid && !lngInvalid;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const data: Record<string, unknown> = {
      name,
      description: description || undefined,
      cooldown_seconds: Number(cooldownSeconds) || 300,
      transition_id: transitionId || (defaultValues ? null : undefined),
      set_flags: setFlags.trim() || "{}",
      is_active: isActive,
      stamp_enabled: stampEnabled,
      stamp_label: stampLabel.trim() || (defaultValues ? null : undefined),
      stamp_order: stampOrder ? Number(stampOrder) : (defaultValues ? null : undefined),
      checkin_mode: checkinMode,
    };

    // Beacon
    if (showBeacon) {
      data.beacon_uuid = beaconUuid || (defaultValues ? null : undefined);
      data.beacon_major = beaconMajor ? Number(beaconMajor) : (defaultValues ? null : undefined);
      data.beacon_minor = beaconMinor ? Number(beaconMinor) : (defaultValues ? null : undefined);
    } else if (defaultValues) {
      data.beacon_uuid = null; data.beacon_major = null; data.beacon_minor = null;
    }

    // GPS
    if (needsGps) {
      data.latitude = latitude ? Number(latitude) : (defaultValues ? null : undefined);
      data.longitude = longitude ? Number(longitude) : (defaultValues ? null : undefined);
      data.radius_meters = radiusMeters ? Number(radiusMeters) : (defaultValues ? null : undefined);
    } else if (defaultValues) {
      data.latitude = null; data.longitude = null; data.radius_meters = null;
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

      {/* ── チェックイン方式 ── */}
      <div style={groupStyle}>
        <label style={labelStyle}>チェックイン方式</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {([
            { value: "qr_only",    label: "QR のみ",  desc: "現地の QR コード読み取りでチェックイン" },
            { value: "gps_only",   label: "GPS のみ",  desc: "現在地が指定範囲内のときチェックイン" },
            { value: "qr_and_gps", label: "QR + GPS", desc: "QR 読み取り＋現在地が範囲内のときのみチェックイン" },
          ] as const).map(({ value, label, desc }) => (
            <label
              key={value}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
                border: `2px solid ${checkinMode === value ? "#2563eb" : "#e5e7eb"}`,
                borderRadius: 8, cursor: "pointer",
                background: checkinMode === value ? "#eff6ff" : "#fff",
              }}
            >
              <input type="radio" name="checkin_mode" value={value} checked={checkinMode === value} onChange={() => setCheckinMode(value)} style={{ marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{label}</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>{desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* ── GPS 座標設定（gps_only / qr_and_gps 時に表示） ── */}
      {needsGps && (
        <div style={{ marginBottom: 16, padding: "12px 14px", border: "1px solid #e5e7eb", borderRadius: 8, display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>GPS 座標設定 *</p>

          {/* 地図ピッカー */}
          <LocationMapPicker
            latitude={latitude ? Number(latitude) : null}
            longitude={longitude ? Number(longitude) : null}
            radiusMeters={Number(radiusMeters) || 50}
            onLocationChange={handleMapLocationChange}
          />

          {/* 数値入力（地図と双方向同期） */}
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>緯度 <span style={subLabel}>— 中心座標</span></label>
              <input style={{ ...inputStyle, borderColor: latInvalid ? "#fca5a5" : "#d1d5db" }} type="number" step="any" min="-90" max="90" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="35.6812" />
              {latInvalid && <p style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>-90〜90 の範囲で入力してください</p>}
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>経度 <span style={subLabel}>— 中心座標</span></label>
              <input style={{ ...inputStyle, borderColor: lngInvalid ? "#fca5a5" : "#d1d5db" }} type="number" step="any" min="-180" max="180" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="139.7671" />
              {lngInvalid && <p style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>-180〜180 の範囲で入力してください</p>}
            </div>
          </div>
          <div>
            <label style={labelStyle}>許容半径（m） <span style={subLabel}>— この範囲内ならチェックイン成功</span></label>
            <input id="radius_meters_input" style={inputStyle} type="number" min="1" max="10000" value={radiusMeters} onChange={(e) => setRadiusMeters(e.target.value)} onInput={(e) => setRadiusMeters((e.target as HTMLInputElement).value)} placeholder="50" />
            {radiusWarning && <p style={{ fontSize: 12, color: "#d97706", marginTop: 2 }}>{radiusWarning}</p>}
            <p style={helpStyle}>推奨: 20m〜100m。地図上の円で範囲を確認できます。</p>
          </div>
          {gpsIncomplete && (
            <p style={{ fontSize: 12, color: "#dc2626" }}>
              この方式では緯度・経度・半径がすべて必要です
            </p>
          )}
        </div>
      )}

      {/* ── Beacon 設定 ── */}
      <CollapsibleSection title="Bluetooth ビーコン設定" subtitle="任意" open={showBeacon} onToggle={() => setShowBeacon(!showBeacon)}>
        <div>
          <label style={labelStyle}>UUID <span style={subLabel}>— ビーコン機器の識別子</span></label>
          <input style={inputStyle} value={beaconUuid} onChange={(e) => setBeaconUuid(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Major <span style={subLabel}>— グループ番号</span></label>
            <input style={inputStyle} type="number" min="0" max="65535" value={beaconMajor} onChange={(e) => setBeaconMajor(e.target.value)} placeholder="0-65535" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Minor <span style={subLabel}>— 個体番号</span></label>
            <input style={inputStyle} type="number" min="0" max="65535" value={beaconMinor} onChange={(e) => setBeaconMinor(e.target.value)} placeholder="0-65535" />
          </div>
        </div>
        <p style={helpStyle}>Beacon 自動検知機能で使用します。未入力でも QR / GPS チェックインは利用できます。</p>
      </CollapsibleSection>

      {/* ── スタンプラリー設定 ── */}
      <div style={{ marginBottom: 16, padding: "12px 14px", border: "1px solid #e5e7eb", borderRadius: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <input type="checkbox" id="stamp_enabled" checked={stampEnabled} onChange={(e) => setStampEnabled(e.target.checked)} style={{ width: 16, height: 16 }} />
          <label htmlFor="stamp_enabled" style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>スタンプラリー対象にする</label>
        </div>
        {stampEnabled && (
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>スタンプ表示名 <span style={subLabel}>— 未入力ならロケーション名</span></label>
              <input style={inputStyle} value={stampLabel} onChange={(e) => setStampLabel(e.target.value)} placeholder={name || "ロケーション名を使用"} maxLength={100} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>並び順</label>
              <input style={inputStyle} type="number" min="0" value={stampOrder} onChange={(e) => setStampOrder(e.target.value)} placeholder="自動" />
            </div>
          </div>
        )}
        <p style={helpStyle}>スタンプ対象にすると、LIFF 画面のスタンプラリー進捗に含まれます。</p>
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
            <option key={t.id} value={t.id}>{t.label} → {t.to_phase?.name ?? "?"}</option>
          ))}
        </select>
        <p style={helpStyle}>遷移元フェーズが現在フェーズと一致する場合のみ発火します。</p>
      </div>

      <div style={groupStyle}>
        <label style={labelStyle}>チェックイン時に設定するフラグ（JSON）</label>
        <textarea
          style={{ ...inputStyle, fontFamily: "monospace", fontSize: 13, minHeight: 60, borderColor: !jsonCheck.valid ? "#fca5a5" : "#d1d5db" }}
          value={setFlags} onChange={(e) => setSetFlags(e.target.value)} placeholder='{"visited_lobby": true}'
        />
        {!jsonCheck.valid && <p style={{ fontSize: 12, color: "#dc2626", marginTop: 2 }}>{jsonCheck.message}</p>}
        <p style={helpStyle}>UserProgress.flags にマージされます。</p>
      </div>

      <div style={{ ...groupStyle, display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" id="is_active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ width: 16, height: 16 }} />
        <label htmlFor="is_active" style={{ fontSize: 14, fontWeight: 500, color: "#374151" }}>有効</label>
      </div>

      <button
        type="submit" disabled={saving || !canSubmit}
        style={{
          width: "100%", padding: "12px",
          background: (saving || !canSubmit) ? "#93c5fd" : "#2563eb",
          color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600,
          cursor: (saving || !canSubmit) ? "not-allowed" : "pointer",
        }}
      >
        {saving ? "保存中..." : defaultValues ? "更新" : "作成"}
      </button>
    </form>
  );
}
