"use client";

// src/components/maps/GoogleMapView.tsx
// Google Maps JavaScript API ベースの共通地図ビュー（client component）。
//
// 表示:
//   - target      : 目的地ピン（AdvancedMarkerElement）
//   - currentLocation : 現在地ピン（青ドット）
//   - radiusMeters: target 中心のチェックイン可能範囲の円
//   - center      : target 優先 → currentLocation → 既定（東京駅）
//   - readonly=false かつ onMapClick あり: 地図クリックで座標更新
//
// 堅牢性:
//   - API キー未設定 / Map ID 未設定 / 読み込み失敗 / 不正座標(null/NaN) でも画面を壊さない
//   - SSR で window/google を参照しない（すべて useEffect 内）
//   - loader は singleton（google-maps-loader.ts）

import { useEffect, useRef, useState } from "react";
import { importLibrary } from "@googlemaps/js-api-loader";
import { ensureGoogleMapsConfigured, GOOGLE_MAPS_MAP_ID } from "@/lib/maps/google-maps-loader";

export type LatLng = { lat: number; lng: number };

export type GoogleMapViewProps = {
  center: LatLng;
  target?: LatLng | null;
  currentLocation?: LatLng | null;
  radiusMeters?: number | null;
  zoom?: number;
  height?: number | string;
  readonly?: boolean;
  onMapClick?: (latLng: LatLng) => void;
  /** target ピンのドラッグで座標更新（draggableTarget=true 時）。 */
  onTargetChange?: (latLng: LatLng) => void;
  /** target ピンをドラッグ可能にする（既定 false）。 */
  draggableTarget?: boolean;
  className?: string;
};

const DEFAULT_CENTER: LatLng = { lat: 35.6812, lng: 139.7671 }; // 東京駅
const CIRCLE_COLOR = "#2563eb";

function isValidLatLng(p?: LatLng | null): p is LatLng {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

type Status = "loading" | "ready" | "error" | "no_key";

export function GoogleMapView({
  center, target, currentLocation, radiusMeters,
  zoom = 16, height = 280, readonly = true, onMapClick, onTargetChange, draggableTarget = false, className,
}: GoogleMapViewProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const targetMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const currentMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const targetDragListenerRef = useRef<google.maps.MapsEventListener | null>(null);

  // 最新の callback / フラグを ref で保持（listener 再登録を避ける）
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onTargetChangeRef = useRef(onTargetChange);
  onTargetChangeRef.current = onTargetChange;
  const draggableTargetRef = useRef(draggableTarget);
  draggableTargetRef.current = draggableTarget;

  const [status, setStatus] = useState<Status>("loading");

  // ── 地図初期化（mount 時 1 回） ──
  useEffect(() => {
    if (!ensureGoogleMapsConfigured()) { setStatus("no_key"); return; }

    let cancelled = false;
    (async () => {
      try {
        const { Map } = await importLibrary("maps");
        await importLibrary("marker");
        if (cancelled || !divRef.current) return;
        const init = isValidLatLng(target) ? target
          : isValidLatLng(currentLocation) ? currentLocation
          : isValidLatLng(center) ? center : DEFAULT_CENTER;
        mapRef.current = new Map(divRef.current, {
          center: init,
          zoom,
          ...(GOOGLE_MAPS_MAP_ID ? { mapId: GOOGLE_MAPS_MAP_ID } : {}),
          clickableIcons: false,
          gestureHandling: "greedy",
          disableDefaultUI: false,
          fullscreenControl: false,
          streetViewControl: false,
          mapTypeControl: false,
        });
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── クリックリスナー（readonly 切替で付け外し） ──
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    clickListenerRef.current?.remove();
    clickListenerRef.current = null;
    if (!readonly) {
      clickListenerRef.current = mapRef.current.addListener("click", (e: google.maps.MapMouseEvent) => {
        const ll = e.latLng;
        if (ll && onMapClickRef.current) onMapClickRef.current({ lat: ll.lat(), lng: ll.lng() });
      });
    }
    return () => { clickListenerRef.current?.remove(); clickListenerRef.current = null; };
  }, [status, readonly]);

  // ── target ピン + 範囲円 + recenter ──
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    const map = mapRef.current;
    let cancelled = false;
    (async () => {
      try {
        const { AdvancedMarkerElement } = await importLibrary("marker");
        if (cancelled) return;

        // target ピン
        if (isValidLatLng(target)) {
          try {
            if (!targetMarkerRef.current) {
              targetMarkerRef.current = new AdvancedMarkerElement({
                map, position: target, title: "目的地",
                gmpDraggable: draggableTargetRef.current,
              });
              // ドラッグ終了で座標を親へ通知（marker 生成時に 1 回だけ登録）
              if (draggableTargetRef.current) {
                targetDragListenerRef.current = targetMarkerRef.current.addListener("dragend", () => {
                  const pos = targetMarkerRef.current?.position;
                  if (!pos) return;
                  const lat = typeof pos.lat === "function" ? pos.lat() : (pos.lat as number);
                  const lng = typeof pos.lng === "function" ? pos.lng() : (pos.lng as number);
                  if (Number.isFinite(lat) && Number.isFinite(lng)) onTargetChangeRef.current?.({ lat, lng });
                });
              }
            } else {
              targetMarkerRef.current.position = target;
              targetMarkerRef.current.map = map;
            }
          } catch { /* mapId 未設定等で marker 不可でも地図は維持 */ }
        } else if (targetMarkerRef.current) {
          targetMarkerRef.current.map = null;
        }

        // 範囲円
        if (isValidLatLng(target) && radiusMeters && radiusMeters > 0) {
          if (!circleRef.current) {
            circleRef.current = new google.maps.Circle({
              map, center: target, radius: radiusMeters,
              strokeColor: CIRCLE_COLOR, strokeOpacity: 0.8, strokeWeight: 2,
              fillColor: CIRCLE_COLOR, fillOpacity: 0.12, clickable: false,
            });
          } else {
            circleRef.current.setCenter(target);
            circleRef.current.setRadius(radiusMeters);
            circleRef.current.setMap(map);
          }
        } else if (circleRef.current) {
          circleRef.current.setMap(null);
        }

        // recenter（target 優先）。検索/手入力/クリック/ドラッグのいずれでも選択地点へ確実に移動。
        const c = isValidLatLng(target) ? target
          : isValidLatLng(currentLocation) ? currentLocation
          : isValidLatLng(center) ? center : null;
        if (c) {
          map.panTo(c);
          // 広域表示のままだとピン移動が分かりにくいので、ズームが浅い場合だけ寄せる。
          const z = map.getZoom();
          if (typeof z === "number" && z < 14) map.setZoom(16);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, target?.lat, target?.lng, radiusMeters]);

  // ── 現在地ピン（青ドット） ──
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    const map = mapRef.current;
    let cancelled = false;
    (async () => {
      try {
        const { AdvancedMarkerElement } = await importLibrary("marker");
        if (cancelled) return;
        if (isValidLatLng(currentLocation)) {
          try {
            const dot = document.createElement("div");
            dot.style.cssText = "width:16px;height:16px;border-radius:50%;background:#1a73e8;border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.2);";
            if (!currentMarkerRef.current) {
              currentMarkerRef.current = new AdvancedMarkerElement({ map, position: currentLocation, title: "現在地", content: dot });
            } else {
              currentMarkerRef.current.position = currentLocation;
              currentMarkerRef.current.content = dot;
              currentMarkerRef.current.map = map;
            }
          } catch { /* ignore */ }
        } else if (currentMarkerRef.current) {
          currentMarkerRef.current.map = null;
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, currentLocation?.lat, currentLocation?.lng]);

  // unmount 時にリスナーを掃除
  useEffect(() => () => {
    clickListenerRef.current?.remove();
    targetDragListenerRef.current?.remove();
  }, []);

  const heightStyle = typeof height === "number" ? `${height}px` : height;

  // ── fallback / loading 表示（画面を壊さない） ──
  if (status === "no_key" || status === "error") {
    return (
      <div
        className={className}
        style={{
          height: heightStyle, borderRadius: 12, border: "1px solid var(--liff-border,#EAEAEA)",
          background: "#f5f8f6", display: "flex", alignItems: "center", justifyContent: "center",
          padding: 16, textAlign: "center",
        }}
      >
        <p style={{ fontSize: 12, color: "#8C8C8C", lineHeight: 1.6, margin: 0 }}>
          {status === "no_key"
            ? "地図を表示できません。Google Maps API キーが未設定です。"
            : "地図の読み込みに失敗しました。"}
        </p>
      </div>
    );
  }

  return (
    <div className={className} style={{ position: "relative", height: heightStyle, borderRadius: 12, overflow: "hidden", border: "1px solid var(--liff-border,#EAEAEA)" }}>
      {status === "loading" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f8f6", zIndex: 1 }}>
          <span style={{ fontSize: 12, color: "#8C8C8C" }}>地図を読み込み中…</span>
        </div>
      )}
      <div ref={divRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
