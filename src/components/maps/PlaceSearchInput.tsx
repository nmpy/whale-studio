"use client";

// src/components/maps/PlaceSearchInput.tsx
// 場所名・住所で検索して座標を返す管理画面用 input（Google Places）。
//
// - Places library（importLibrary("places")）はこのコンポーネントが描画されたときのみ読み込む。
//   LIFF GPS チェックイン画面（GoogleMapView 単体）では places を読み込まない。
// - 新 API の PlaceAutocompleteElement を使用（classic Autocomplete は新規顧客向けに非提供のため）。
// - 選択地点の location（lat/lng）だけを fetchFields で取得（場所名等は保存しない）。
// - APIキー未設定 / Places 未有効 / 読み込み失敗 / location 無し / NaN でも画面を壊さない。

import { useEffect, useRef, useState } from "react";
import { importLibrary } from "@googlemaps/js-api-loader";
import { ensureGoogleMapsConfigured } from "@/lib/maps/google-maps-loader";
import type { LatLng } from "@/components/maps/GoogleMapView";

const inputCls: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid #d1d5db",
  borderRadius: 8, fontSize: 13, background: "#fff",
};

export function PlaceSearchInput({ onSelect }: { onSelect: (latLng: LatLng) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [status, setStatus] = useState<"loading" | "ready" | "no_key" | "error">("loading");

  useEffect(() => {
    if (!ensureGoogleMapsConfigured()) { setStatus("no_key"); return; }

    let cancelled = false;
    let el: google.maps.places.PlaceAutocompleteElement | null = null;
    let listener: ((e: Event) => void) | null = null;

    (async () => {
      try {
        const places = (await importLibrary("places")) as google.maps.PlacesLibrary;
        if (cancelled || !containerRef.current) return;

        el = new places.PlaceAutocompleteElement({});
        el.style.width = "100%";

        listener = async (e: Event) => {
          try {
            const place = (e as google.maps.places.PlaceSelectEvent).place;
            // 必要最小限のフィールドのみ取得（不要な Place Details を取らない）
            await place.fetchFields({ fields: ["location"] });
            const loc = place.location; // google.maps.LatLng | null
            if (!loc) return;
            const lat = loc.lat();
            const lng = loc.lng();
            if (Number.isFinite(lat) && Number.isFinite(lng)) onSelectRef.current({ lat, lng });
          } catch { /* place 取得失敗時は何もしない（画面は壊さない） */ }
        };

        el.addEventListener("gmp-select", listener);
        containerRef.current.appendChild(el);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (el && listener) el.removeEventListener("gmp-select", listener);
      if (el && el.parentElement) el.parentElement.removeChild(el);
    };
  }, []);

  const unavailable = status === "no_key" || status === "error";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>場所名・住所で検索</label>
      {/* PlaceAutocompleteElement の挿入先。loading/ready 時のみ表示。 */}
      <div ref={containerRef} style={{ display: unavailable ? "none" : "block" }} />
      {unavailable && (
        <input
          type="text"
          disabled
          placeholder="検索を利用できません（Google Maps API キー / Places API を確認してください）"
          style={{ ...inputCls, background: "#f9fafb", color: "#9ca3af" }}
        />
      )}
      <span style={{ fontSize: 11, color: "#9ca3af" }}>
        例）東京タワー、渋谷駅、東京都港区芝公園4丁目 / 地図クリック・ピンのドラッグでも設定できます
      </span>
    </div>
  );
}
