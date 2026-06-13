"use client";

// src/components/maps/PlaceSearchInput.tsx
// 場所名・住所で検索して座標を返す管理画面用 input（Google Places API New）。
//
// - 通常の白背景 input + 「検索」ボタン + Enter で検索（Place.searchByText の最上位結果）。
// - 入力中はサジェスト候補（AutocompleteSuggestion）を表示し、候補クリックでも反映。
// - 取得した location（lat/lng のみ）を onSelect で親へ渡す（場所名は保存しない）。
// - Places library（importLibrary("places")）はこのコンポーネント描画時のみ読み込む。
//   LIFF GPS チェックイン（GoogleMapView 単体）では places を読み込まない。
// - APIキー未設定 / Places 未有効 / 失敗 / location 無し / NaN でも画面を壊さない。

import { useCallback, useEffect, useRef, useState } from "react";
import { importLibrary } from "@googlemaps/js-api-loader";
import { ensureGoogleMapsConfigured } from "@/lib/maps/google-maps-loader";
import type { LatLng } from "@/components/maps/GoogleMapView";

const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, padding: "8px 12px", border: "1px solid #d1d5db",
  borderRadius: 8, fontSize: 14, background: "#fff", color: "#111827", outline: "none",
};

type Suggestion = { id: string; label: string; place: google.maps.places.Place };

export function PlaceSearchInput({ onSelect }: { onSelect: (latLng: LatLng) => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "no_key" | "error">("loading");
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const placesRef = useRef<google.maps.PlacesLibrary | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Places library を読み込む（管理画面のみ）
  useEffect(() => {
    if (!ensureGoogleMapsConfigured()) { setStatus("no_key"); return; }
    let cancelled = false;
    (async () => {
      try {
        const places = await importLibrary("places");
        if (cancelled) return;
        placesRef.current = places;
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // location（LatLng | LatLngLiteral）→ 親へ通知。取得不能/NaN なら false。
  const emit = useCallback((loc: google.maps.LatLng | google.maps.LatLngLiteral | null | undefined): boolean => {
    if (!loc) { setMsg("場所を特定できませんでした"); return false; }
    const lat = typeof loc.lat === "function" ? loc.lat() : loc.lat;
    const lng = typeof loc.lng === "function" ? loc.lng() : loc.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { setMsg("場所を特定できませんでした"); return false; }
    onSelectRef.current({ lat, lng });
    return true;
  }, []);

  // Enter / 検索ボタン → テキスト検索（最上位結果）
  const runSearch = useCallback(async () => {
    const q = query.trim();
    setMsg(null);
    setSuggestions([]);
    if (!q) { setMsg("検索する地名・住所を入力してください"); return; }
    const places = placesRef.current;
    if (!places) { setMsg("Places API が利用できないため、地図クリックまたは座標入力で設定してください"); return; }
    setSearching(true);
    try {
      const { places: results } = await places.Place.searchByText({ textQuery: q, fields: ["location"], maxResultCount: 1 });
      if (!results || results.length === 0) { setMsg("検索結果が見つかりませんでした"); return; }
      if (emit(results[0].location)) setMsg(null);
    } catch {
      setMsg("検索に失敗しました。地図クリックまたは座標入力で設定してください");
    } finally {
      setSearching(false);
    }
  }, [query, emit]);

  // 入力中のサジェスト候補（debounce）
  useEffect(() => {
    const q = query.trim();
    if (status !== "ready" || !placesRef.current || q.length < 2) { setSuggestions([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { suggestions: sugg } = await placesRef.current!.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: q });
        if (cancelled) return;
        const list: Suggestion[] = [];
        for (const s of sugg) {
          const p = s.placePrediction;
          if (!p) continue;
          list.push({ id: p.placeId, label: p.text?.text ?? p.mainText?.text ?? "", place: p.toPlace() });
        }
        setSuggestions(list.slice(0, 5));
      } catch { /* サジェスト取得失敗は無視（検索ボタンは使える） */ }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, status]);

  // 候補クリック
  const pickSuggestion = useCallback(async (s: Suggestion) => {
    setMsg(null);
    setSuggestions([]);
    setQuery(s.label);
    try {
      await s.place.fetchFields({ fields: ["location"] });
      emit(s.place.location);
    } catch {
      setMsg("場所を特定できませんでした");
    }
  }, [emit]);

  const disabled = status === "no_key" || status === "error";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, position: "relative" }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>場所名・住所で検索</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } }}
          placeholder="例）東京タワー、渋谷駅、東京都港区芝公園4丁目"
          disabled={disabled}
          style={{ ...inputStyle, ...(disabled ? { background: "#f9fafb", color: "#9ca3af" } : {}) }}
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={disabled || searching}
          style={{ flex: "none", padding: "8px 16px", fontSize: 13, fontWeight: 600, color: "#fff", background: disabled ? "#9ca3af" : "#2563eb", border: "none", borderRadius: 8, cursor: disabled || searching ? "not-allowed" : "pointer" }}
        >
          {searching ? "検索中…" : "検索"}
        </button>
      </div>

      {suggestions.length > 0 && (
        <ul style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, margin: "2px 0 0", padding: 4, listStyle: "none", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,.1)" }}>
          {suggestions.map((s) => (
            <li key={s.id}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }} style={{ width: "100%", textAlign: "left", padding: "8px 10px", fontSize: 13, background: "transparent", border: "none", borderRadius: 6, cursor: "pointer", color: "#111827" }}>
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {msg && <span style={{ fontSize: 11, color: "#dc2626" }}>{msg}</span>}
      <span style={{ fontSize: 11, color: "#9ca3af" }}>
        {disabled
          ? "検索を利用できません（Google Maps API キー / Places API を確認）。地図クリック・座標入力で設定できます。"
          : "Enter または「検索」で移動。候補クリックでも移動します。地図クリック・ピンドラッグ・座標入力でも設定できます。"}
      </span>
    </div>
  );
}
