"use client";

// src/components/LocationMapPicker.tsx
// Google Maps ベースの座標 + 半径ピッカー（管理画面の Location フォーム用）。
// PR #281 で作成した共通 GoogleMapView を editable モードで再利用する。
//
// 機能:
//   - 地図クリックでピン移動 → lat/lng をコールバック
//   - 目的地ピンのドラッグでも座標変更
//   - radius_meters を円で可視化
//   - 「現在地を設定」ボタン
//   - 半径クイック選択 + スライダー
//   - 数値入力と双方向同期（props 経由）
//
// 公開 props / 既存の使用箇所（_form.tsx）は不変。内部地図を Leaflet → Google Maps に置換。

import { useCallback, useState } from "react";
import { GoogleMapView, type LatLng } from "@/components/maps/GoogleMapView";
import { PlaceSearchInput } from "@/components/maps/PlaceSearchInput";

interface LocationMapPickerProps {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  onLocationChange: (lat: number, lng: number) => void;
  onRadiusChange?: (radius: number) => void;
  height?: number;
}

const DEFAULT_CENTER: LatLng = { lat: 35.6812, lng: 139.7671 }; // 東京駅

const RADIUS_PRESETS = [20, 50, 100, 200, 500] as const;
const RADIUS_LABELS: Record<number, string> = {
  10: "建物内", 20: "ごく近く", 50: "敷地内", 100: "ブロック", 200: "周辺", 300: "エリア", 500: "広域",
};

export default function LocationMapPicker({
  latitude,
  longitude,
  radiusMeters,
  onLocationChange,
  onRadiusChange,
  height = 320,
}: LocationMapPickerProps) {
  const [gettingLocation, setGettingLocation] = useState(false);

  const hasPosition = latitude != null && longitude != null;
  const target: LatLng | null = hasPosition ? { lat: latitude!, lng: longitude! } : null;
  const center: LatLng = target ?? DEFAULT_CENTER;

  const handleGetCurrentLocation = useCallback(() => {
    if (!("geolocation" in navigator)) return;
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onLocationChange(pos.coords.latitude, pos.coords.longitude);
        setGettingLocation(false);
      },
      () => setGettingLocation(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [onLocationChange]);

  const handleRadiusPreset = useCallback((r: number) => {
    if (onRadiusChange) {
      onRadiusChange(r);
    } else {
      // fallback: DOM イベントで伝搬（後方互換）
      const input = document.getElementById("radius_meters_input") as HTMLInputElement | null;
      if (input) {
        const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        nativeSet?.call(input, String(r));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }, [onRadiusChange]);

  // 半径目安テキスト
  const radiusLabel = RADIUS_LABELS[radiusMeters] ?? (
    radiusMeters <= 20 ? "ごく近く" :
    radiusMeters <= 50 ? "敷地内" :
    radiusMeters <= 100 ? "ブロック" :
    radiusMeters <= 300 ? "エリア" : "広域"
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* 場所名・住所検索（地図の上）。選択地点を lat/lng に反映（4経路の更新は onLocationChange に集約）。 */}
      <PlaceSearchInput onSelect={(ll) => onLocationChange(ll.lat, ll.lng)} />

      {/* ツールバー */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          onClick={handleGetCurrentLocation}
          disabled={gettingLocation}
          style={{
            padding: "6px 12px", fontSize: 12, fontWeight: 600,
            background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb",
            borderRadius: 6, cursor: gettingLocation ? "not-allowed" : "pointer",
          }}
        >
          {gettingLocation ? "取得中..." : "📍 現在地を設定"}
        </button>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>
          地図をクリックまたはピンをドラッグして座標を設定
        </span>
      </div>

      {/* 半径: クイック選択 + スライダー */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#6b7280", flexShrink: 0 }}>半径:</span>
          {RADIUS_PRESETS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => handleRadiusPreset(r)}
              style={{
                padding: "3px 10px", fontSize: 11, fontWeight: 500,
                background: radiusMeters === r ? "#2563eb" : "#f3f4f6",
                color: radiusMeters === r ? "#fff" : "#374151",
                border: `1px solid ${radiusMeters === r ? "#2563eb" : "#e5e7eb"}`,
                borderRadius: 4, cursor: "pointer",
              }}
            >
              {r}m
            </button>
          ))}
          <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 4 }}>{radiusLabel}</span>
        </div>
        {/* スライダー */}
        {onRadiusChange && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: "#9ca3af", flexShrink: 0 }}>10m</span>
            <input
              type="range"
              min={10}
              max={500}
              step={5}
              value={radiusMeters}
              onChange={(e) => onRadiusChange(Number(e.target.value))}
              style={{ flex: 1, accentColor: "#2563eb" }}
            />
            <span style={{ fontSize: 10, color: "#9ca3af", flexShrink: 0 }}>500m</span>
          </div>
        )}
      </div>

      {/* 地図（Google Maps / editable）。APIキー未設定時は GoogleMapView 内で fallback 表示。 */}
      <GoogleMapView
        center={center}
        target={target}
        radiusMeters={radiusMeters > 0 ? radiusMeters : null}
        zoom={hasPosition ? 16 : 15}
        height={height}
        readonly={false}
        onMapClick={(ll) => onLocationChange(ll.lat, ll.lng)}
        draggableTarget
        onTargetChange={(ll) => onLocationChange(ll.lat, ll.lng)}
      />

      {hasPosition && (
        <p style={{ fontSize: 11, color: "#9ca3af" }}>
          座標: {latitude!.toFixed(6)}, {longitude!.toFixed(6)} / 半径: {radiusMeters}m
        </p>
      )}
    </div>
  );
}
