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
  | "blocked"
  | "unavailable"
  | "error";

interface GpsCheckinProps {
  locationId: string;
  workId: string;
  lineUserId: string;
  locationName?: string;
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

/** Permissions API で事前に geolocation の許可状態を確認（対応ブラウザのみ） */
async function queryPermissionState(): Promise<PermissionState | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions) return null;
    const result = await navigator.permissions.query({ name: "geolocation" });
    return result.state;
  } catch {
    return null;
  }
}

/** 距離を読みやすい文字列に変換 */
function formatDistance(meters: number): string {
  if (meters < 1000) return `約${Math.round(meters)}m`;
  return `約${(meters / 1000).toFixed(1)}km`;
}

export function GpsCheckin({ locationId, workId, lineUserId, locationName, onResult }: GpsCheckinProps) {
  const [status, setStatus] = useState<GpsStatus>("idle");
  const [message, setMessage] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [distanceInfo, setDistanceInfo] = useState<{ distance: number; radius: number } | null>(null);
  const [successData, setSuccessData] = useState<{
    message?: string;
    transition?: { name: string } | null;
  } | null>(null);
  const submittingRef = useRef(false);

  const supported = typeof navigator !== "undefined" && "geolocation" in navigator;

  const handleGpsCheckin = useCallback(async () => {
    if (!supported || submittingRef.current) return;
    submittingRef.current = true;

    setDistanceInfo(null);
    setSuccessData(null);

    // Permissions API で事前判定（対応環境のみ）
    const permState = await queryPermissionState();
    if (permState === "denied") {
      setStatus("blocked");
      setMessage("位置情報の利用がブロックされています");
      sendAttemptLog({ workId, locationId, lineUserId, status: "permission_denied", failureReason: "blocked_by_permissions_api" });
      submittingRef.current = false;
      return;
    }

    setStatus("acquiring");
    setMessage("位置情報を取得中...");

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
        setMessage("まだ目的地に到着していません");
        setDistanceInfo({ distance: data.distance_meters, radius: data.radius_meters });
        return;
      }

      setStatus("success");
      setSuccessData({
        message: data.message,
        transition: data.transition ?? null,
      });
      // success UI を 1.2 秒表示してから親に委譲
      setTimeout(() => onResult(data), 1200);
    } catch (err) {
      if (err instanceof GeolocationPositionError) {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setStatus("denied");
            setMessage("位置情報の利用が許可されていません");
            sendAttemptLog({ workId, locationId, lineUserId, status: "permission_denied" });
            break;
          case err.POSITION_UNAVAILABLE:
            setStatus("unavailable");
            setMessage("現在地を取得できませんでした。電波状況のよい場所でお試しください。");
            sendAttemptLog({ workId, locationId, lineUserId, status: "gps_unavailable" });
            break;
          case err.TIMEOUT:
            setStatus("error");
            setMessage("位置情報の取得に時間がかかっています。もう一度お試しください。");
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
    setSuccessData(null);
  }, []);

  if (!supported) return null;

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid #e5e7eb", paddingTop: 16 }}>

      {/* ── idle: 事前説明 + チェックインボタン ── */}
      {status === "idle" && (
        <div>
          <div style={{
            background: "#f7f9fc", borderRadius: 10, padding: "14px 16px",
            marginBottom: 12, lineHeight: 1.7,
          }}>
            <p style={{ fontSize: 13, color: "#435068", marginBottom: 6 }}>
              このチェックインでは現在地を使って、目的地に到着したかを確認します。
            </p>
            <p style={{ fontSize: 12, color: "#97a3b6" }}>
              位置情報はこのチェックイン判定のために使用し、常時追跡は行いません。
              下のボタンを押すと、位置情報の利用確認が表示されます。
            </p>
          </div>
          <button
            type="button"
            onClick={handleGpsCheckin}
            style={{
              width: "100%", padding: "14px 0",
              background: "#f3f4f6", color: "#374151",
              border: "1px solid #e5e7eb", borderRadius: 10,
              fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            📍 現在地でチェックイン
          </button>
        </div>
      )}

      {/* ── acquiring / submitting: スピナー ── */}
      {(status === "acquiring" || status === "submitting") && (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div style={spinnerStyle} />
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>{message}</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ── success: 成功表示 ── */}
      {status === "success" && (
        <div style={{
          textAlign: "center", padding: "20px 16px",
          background: "#f0fdf4", borderRadius: 12, border: "1px solid #bbf7d0",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 12px",
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#16a34a", marginBottom: 4 }}>
            チェックイン完了！
          </p>
          {successData?.message && (
            <p style={{ fontSize: 13, color: "#435068" }}>{successData.message}</p>
          )}
          {successData?.transition && (
            <p style={{ fontSize: 12, color: "#2563eb", marginTop: 8 }}>
              物語が進行します…
            </p>
          )}
        </div>
      )}

      {/* ── out_of_range: 未到着 ── */}
      {status === "out_of_range" && (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div style={{
            background: "#fffbeb", borderRadius: 10, padding: "16px",
            border: "1px solid #fde68a", marginBottom: 12,
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📡</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#92400e", marginBottom: 6 }}>
              まだ目的地に到着していません
            </p>
            <p style={{ fontSize: 13, color: "#78716c", marginBottom: 10, lineHeight: 1.6 }}>
              現在地の取得には成功しましたが、チェックイン可能範囲外です。
            </p>
            <div style={{
              background: "rgba(255,255,255,0.7)", borderRadius: 8, padding: "10px 12px",
              fontSize: 12, color: "#57534e", lineHeight: 1.8, textAlign: "left",
            }}>
              {locationName && <div><span style={{ fontWeight: 600 }}>対象地点：</span>{locationName}</div>}
              {distanceInfo && (
                <>
                  <div><span style={{ fontWeight: 600 }}>チェックイン範囲：</span>半径{distanceInfo.radius}m 以内</div>
                  <div><span style={{ fontWeight: 600 }}>現在の距離：</span>{formatDistance(distanceInfo.distance)}</div>
                </>
              )}
            </div>
            <p style={{ fontSize: 12, color: "#97a3b6", marginTop: 10 }}>
              目的地の近くに到着したら、もう一度お試しください。
            </p>
          </div>
          <button type="button" onClick={handleRetry} style={retryBtnStyle}>
            もう一度確認する
          </button>
        </div>
      )}

      {/* ── denied: 今回拒否 ── */}
      {status === "denied" && (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div style={{
            background: "#fef2f2", borderRadius: 10, padding: "16px",
            border: "1px solid #fecaca", marginBottom: 12,
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🚫</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#dc2626", marginBottom: 6 }}>
              位置情報の利用が許可されていません
            </p>
            <p style={{ fontSize: 13, color: "#78716c", lineHeight: 1.6 }}>
              チェックインには位置情報の許可が必要です。
              もう一度お試しいただくか、端末やブラウザの設定をご確認ください。
            </p>
          </div>
          <button type="button" onClick={handleRetry} style={retryBtnStyle}>
            もう一度試す
          </button>
          <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
            または QR コードからチェックインしてください
          </p>
        </div>
      )}

      {/* ── blocked: 恒久ブロック（設定変更が必要） ── */}
      {status === "blocked" && (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div style={{
            background: "#fef2f2", borderRadius: 10, padding: "16px",
            border: "1px solid #fecaca", marginBottom: 12,
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⚙️</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#dc2626", marginBottom: 6 }}>
              位置情報がブロックされています
            </p>
            <p style={{ fontSize: 13, color: "#78716c", lineHeight: 1.6, marginBottom: 10 }}>
              以前に位置情報の利用を拒否したため、ブラウザが自動的にブロックしています。
            </p>
            <div style={{
              background: "rgba(255,255,255,0.7)", borderRadius: 8, padding: "12px",
              fontSize: 12, color: "#57534e", lineHeight: 1.8, textAlign: "left",
            }}>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>設定を変更するには：</p>
              <p>LINE アプリ、ブラウザ、または端末の設定から「位置情報」の許可をご確認ください。</p>
              <p>設定変更後、この画面に戻って再試行してください。</p>
            </div>
          </div>
          <button type="button" onClick={handleRetry} style={retryBtnStyle}>
            設定を変更したので再試行する
          </button>
          <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
            または QR コードからチェックインしてください
          </p>
        </div>
      )}

      {/* ── unavailable: 位置取得不能 ── */}
      {status === "unavailable" && (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div style={{
            background: "#fffbeb", borderRadius: 10, padding: "16px",
            border: "1px solid #fde68a", marginBottom: 12,
          }}>
            <p style={{ fontSize: 13, color: "#92400e", lineHeight: 1.6 }}>{message}</p>
          </div>
          <button type="button" onClick={handleRetry} style={retryBtnStyle}>
            もう一度試す
          </button>
          <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
            または QR コードからチェックインしてください
          </p>
        </div>
      )}

      {/* ── error: その他エラー ── */}
      {status === "error" && (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div style={{
            background: "#fef2f2", borderRadius: 10, padding: "16px",
            border: "1px solid #fecaca", marginBottom: 12,
          }}>
            <p style={{ fontSize: 13, color: "#dc2626", lineHeight: 1.6 }}>{message}</p>
          </div>
          <button type="button" onClick={handleRetry} style={retryBtnStyle}>
            もう一度試す
          </button>
        </div>
      )}
    </div>
  );
}

const spinnerStyle: React.CSSProperties = {
  width: 28, height: 28,
  border: "3px solid #e5e7eb", borderTopColor: "#2563eb",
  borderRadius: "50%", animation: "spin 1s linear infinite",
  margin: "0 auto",
};

const retryBtnStyle: React.CSSProperties = {
  width: "100%", padding: "12px 0",
  background: "#f3f4f6", color: "#374151",
  border: "1px solid #e5e7eb", borderRadius: 10,
  fontSize: 13, fontWeight: 500, cursor: "pointer",
};
