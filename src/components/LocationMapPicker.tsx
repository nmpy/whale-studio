"use client";

// src/components/LocationMapPicker.tsx
// Leaflet ベースの座標 + 半径ピッカー。
// Location フォームで GPS 設定時に使用する。
//
// 機能:
//   - 地図クリックでピン移動 → lat/lng をコールバック
//   - ピンドラッグでも座標変更
//   - radius_meters を円で可視化
//   - 「現在地を設定」ボタン
//   - 半径クイック選択
//   - 数値入力と双方向同期（props 経由）
//
// SSR 非対応のため dynamic import で使うこと:
//   const LocationMapPicker = dynamic(() => import("@/components/LocationMapPicker"), { ssr: false });

import { useEffect, useRef, useCallback, useState } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet のデフォルトアイコンを修正（webpack で壊れる問題の回避）
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface LocationMapPickerProps {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  onLocationChange: (lat: number, lng: number) => void;
}

const DEFAULT_CENTER: [number, number] = [35.6812, 139.7671]; // 東京駅
const DEFAULT_ZOOM = 15;

/** 地図クリックとマーカードラッグのハンドラ */
function MapClickHandler({ onLocationChange }: { onLocationChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onLocationChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** props の lat/lng が変わったとき地図の表示を追従させる */
function MapSync({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  const prevRef = useRef<string>("");

  useEffect(() => {
    if (lat == null || lng == null) return;
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (key === prevRef.current) return;
    prevRef.current = key;
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);

  return null;
}

export default function LocationMapPicker({
  latitude,
  longitude,
  radiusMeters,
  onLocationChange,
}: LocationMapPickerProps) {
  const [gettingLocation, setGettingLocation] = useState(false);
  const markerRef = useRef<L.Marker>(null);

  const center: [number, number] =
    latitude != null && longitude != null ? [latitude, longitude] : DEFAULT_CENTER;

  const handleMarkerDrag = useCallback(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const pos = marker.getLatLng();
    onLocationChange(pos.lat, pos.lng);
  }, [onLocationChange]);

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

  const hasPosition = latitude != null && longitude != null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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

      {/* 半径クイック選択 */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#6b7280" }}>半径:</span>
        {[30, 50, 100, 300].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => {
              // 親のフォームに変更を伝える — 直接 radiusMeters を変更するのではなく
              // hidden input のトリックで伝搬するか、onRadiusChange コールバックが必要
              // ここでは DOM イベントをディスパッチ
              const input = document.getElementById("radius_meters_input") as HTMLInputElement | null;
              if (input) {
                const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
                nativeSet?.call(input, String(r));
                input.dispatchEvent(new Event("input", { bubbles: true }));
              }
            }}
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
      </div>

      {/* 地図 */}
      <div style={{ height: 320, borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }}>
        <MapContainer
          center={center}
          zoom={hasPosition ? 16 : DEFAULT_ZOOM}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickHandler onLocationChange={onLocationChange} />
          <MapSync lat={latitude} lng={longitude} />

          {hasPosition && (
            <>
              <Marker
                position={[latitude!, longitude!]}
                icon={defaultIcon}
                draggable={true}
                ref={markerRef}
                eventHandlers={{ dragend: handleMarkerDrag }}
              />
              {radiusMeters > 0 && (
                <Circle
                  center={[latitude!, longitude!]}
                  radius={radiusMeters}
                  pathOptions={{
                    color: "#2563eb",
                    fillColor: "#2563eb",
                    fillOpacity: 0.12,
                    weight: 2,
                  }}
                />
              )}
            </>
          )}
        </MapContainer>
      </div>

      {hasPosition && (
        <p style={{ fontSize: 11, color: "#9ca3af" }}>
          座標: {latitude!.toFixed(6)}, {longitude!.toFixed(6)} / 半径: {radiusMeters}m
        </p>
      )}
    </div>
  );
}
