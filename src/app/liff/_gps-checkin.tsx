"use client";

// src/app/liff/_gps-checkin.tsx
// GPS チェックインコンポーネント（LIFF ページ内で使用）
// QR チェックインの補助導線。非対応・拒否時は QR へ自然にフォールバック。
// クライアント側で分かる失敗（権限拒否等）も試行ログとして API に送信する。

import { useState, useCallback, useRef } from "react";

export type GpsStatus =
  | "idle"
  | "acquiring"
  | "submitting"
  | "success"
  | "out_of_range"
  | "denied"
  | "unavailable"
  | "error";

interface GpsCheckinProps {
  locationId: string;
  workId: string;
  lineUserId: string;
  onResult: (result: unknown) => void;
}

/** クライアント側失敗をログ送信（fire-and-forget） */
function sendAttemptLog(params: {
  workId: string; locationId: string; lineUserId: string;
  status: string; failureReason?: string;
}): void {
  fetch("/api/liff/checkin-attempt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      work_id:        params.workId,
      location_id:    params.locationId,
      line_user_id:   params.lineUserId,
      status:         params.status,
      failure_reason: params.failureReason,
    }),
  }).catch(() => { /* fire-and-forget */ });
}

export function GpsCheckin({ locationId, workId, lineUserId, onResult }: GpsCheckinProps) {
  const [status, setStatus] = useState<GpsStatus>("idle");
  const [message, setMessage] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [distanceInfo, setDistanceInfo] = useState<{ distance: number; radius: number } | null>(null);
  const submittingRef = useRef(false);

  const supported = typeof navigator !== "undefined" && "geolocation" in navigator;

  const handleGpsCheckin = useCallback(async () => {
    if (!supported || submittingRef.current) return;
    submittingRef.current = true;

    setStatus("acquiring");
    setMessage("位置情報を取得中...");
    setDistanceInfo(null);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 15000, maximumAge: 0,
        });
      });

      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      setCoords({ lat, lng });
      setStatus("submitting");
      setMessage("チェックイン判定中...");

      const res = await fetch("/api/liff/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_user_id: lineUserId, location_id: locationId, work_id: workId,
          checkin_method: "gps", lat, lng,
        }),
      });

      const json = await res.json();

      if (!json.success) {
        setStatus("error");
        setMessage(json.error?.message ?? "チェックインに失敗しました");
        return;
      }

      const data = json.data;
      if (data.status === "out_of_range") {
        setStatus("out_of_range");
        setMessage("チェックイン可能範囲の外にいます");
        setDistanceInfo({ distance: data.distance_meters, radius: data.radius_meters });
        return;
      }

      setStatus("success");
      onResult(data);
    } catch (err) {
      if (err instanceof GeolocationPositionError) {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setStatus("denied");
            setMessage("位置情報の利用が許可されていません。端末の設定から位置情報を許可してください。");
            sendAttemptLog({ workId, locationId, lineUserId, status: "permission_denied" });
            break;
          case err.POSITION_UNAVAILABLE:
            setStatus("unavailable");
            setMessage("位置情報を取得できませんでした。屋外や電波の良い場所でお試しください。");
            sendAttemptLog({ workId, locationId, lineUserId, status: "gps_unavailable" });
            break;
          case err.TIMEOUT:
            setStatus("error");
            setMessage("位置情報の取得がタイムアウトしました。");
            sendAttemptLog({ workId, locationId, lineUserId, status: "timeout" });
            break;
          default:
            setStatus("error");
            setMessage("位置情報の取得に失敗しました");
            sendAttemptLog({ workId, locationId, lineUserId, status: "unknown_error" });
        }
      } else {
        setStatus("error");
        setMessage("通信エラーが発生しました");
      }
    } finally {
      submittingRef.current = false;
    }
  }, [supported, locationId, workId, lineUserId, onResult]);

  const handleRetry = useCallback(() => {
    setStatus("idle");
    setMessage("");
    setDistanceInfo(null);
  }, []);

  if (!supported) return null;

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid #e5e7eb", paddingTop: 16 }}>
      <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", marginBottom: 8 }}>または</p>

      {status === "idle" && (
        <button type="button" onClick={handleGpsCheckin} style={{ width: "100%", padding: "12px 0", background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          現在地でチェックイン
        </button>
      )}

      {(status === "acquiring" || status === "submitting") && (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <div style={{ width: 24, height: 24, border: "3px solid #e5e7eb", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 8px" }} />
          <p style={{ fontSize: 13, color: "#6b7280" }}>{message}</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {status === "out_of_range" && (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <div style={{ fontSize: 24, marginBottom: 4 }}>📏</div>
          <p style={{ fontSize: 13, color: "#dc2626", fontWeight: 500, marginBottom: 4 }}>{message}</p>
          {distanceInfo && <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>現在地からの距離: 約{distanceInfo.distance}m（許容: {distanceInfo.radius}m以内）</p>}
          {coords && <p style={{ fontSize: 10, color: "#d1d5db" }}>取得座標: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</p>}
          <button type="button" onClick={handleRetry} style={retryStyle}>もう一度試す</button>
        </div>
      )}

      {(status === "denied" || status === "unavailable") && (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <p style={{ fontSize: 13, color: "#92400e", marginBottom: 4 }}>{message}</p>
          <p style={{ fontSize: 12, color: "#9ca3af" }}>QR コードからチェックインしてください</p>
        </div>
      )}

      {status === "error" && (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <p style={{ fontSize: 13, color: "#dc2626", marginBottom: 4 }}>{message}</p>
          <button type="button" onClick={handleRetry} style={retryStyle}>もう一度試す</button>
        </div>
      )}
    </div>
  );
}

const retryStyle: React.CSSProperties = { fontSize: 12, color: "#6b7280", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", marginTop: 4, padding: 4 };
