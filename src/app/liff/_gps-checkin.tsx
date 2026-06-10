"use client";

// src/app/liff/_gps-checkin.tsx
// GPS チェックインコンポーネント（LIFF ページ内で使用）
// QR チェックインの補助導線。非対応・拒否時は QR へ自然にフォールバック。
// クライアント側で分かる失敗（権限拒否等）も試行ログとして API に送信する。

import { useState, useCallback, useRef } from "react";
import {
  gpsStatusPresentation,
  classifyGeolocationError,
  attemptStatusFor,
  type GpsStatus,
} from "@/lib/liff/gps-status";
import { LiffResultState, LiffLoadingState, type LiffStateVariant } from "@/components/liff/experience";
import { LiffButton } from "@/components/liff/primitives/LiffButton";

// 状態の型は src/lib/liff/gps-status.ts に集約（テスト可能な表示ロジックと共有）。
export type { GpsStatus };

interface GpsCheckinProps {
  locationId: string;
  workId: string;
  lineUserId: string;
  locationName?: string;
  onResult: (result: unknown) => void;
  /** チェックイン方式。"gps"（既定・補助/gps_only）または "qr_and_gps"（QR+GPS 二段階）。
   *  API の checkin_method にそのまま渡す（既存 API 値を踏襲）。 */
  checkinMethod?: "gps" | "qr_and_gps";
  /** idle 時のチェックインボタン文言（既定: 「📍 現在地でチェックイン」）。 */
  buttonLabel?: string;
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

export function GpsCheckin({ locationId, workId, lineUserId, locationName, onResult, checkinMethod = "gps", buttonLabel = "📍 現在地でチェックイン" }: GpsCheckinProps) {
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
          checkin_method: checkinMethod, lat, lng,
        }),
      });

      const json = await res.json();

      if (!json.success) {
        // 作品未開始は専用状態にし、「LINEトークに戻って開始してください」の導線を出す。
        if (json.error?.code === "SCENARIO_NOT_STARTED") {
          setStatus("scenario_not_started");
          setMessage(json.error?.message ?? gpsStatusPresentation("scenario_not_started").message);
          return;
        }
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
        // 状態分類・文言・試行ログ status を gps-status ヘルパーに集約（denied/unavailable/timeout/error）。
        const s = classifyGeolocationError(err);
        setStatus(s);
        setMessage(gpsStatusPresentation(s).message);
        const logStatus = attemptStatusFor(s);
        if (logStatus) sendAttemptLog({ workId, locationId, lineUserId, status: logStatus });
      } else {
        setStatus("error");
        setMessage(gpsStatusPresentation("error").message);
      }
    } finally {
      submittingRef.current = false;
    }
  }, [supported, locationId, workId, lineUserId, onResult, checkinMethod]);

  const handleRetry = useCallback(() => {
    setStatus("idle");
    setMessage("");
    setDistanceInfo(null);
    setSuccessData(null);
  }, []);

  if (!supported) return null;

  const pres = gpsStatusPresentation(status, {
    locationName,
    distanceMeters: distanceInfo?.distance ?? null,
    radiusMeters: distanceInfo?.radius ?? null,
    successMessage: successData?.message ?? null,
    hasTransition: !!successData?.transition,
    detailMessage: message || null,
  });

  const backToLine = async () => {
    try { const liff = (await import("@line/liff")).default; if (liff.isInClient()) { liff.closeWindow(); return; } } catch { /* noop */ }
    window.close();
  };

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--liff-border,#EAEAEA)", paddingTop: 16 }}>

      {/* ── idle: 事前説明 + チェックインボタン ── */}
      {status === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "#f1f7fb", borderRadius: 12, padding: "14px 16px", lineHeight: 1.75 }}>
            <p style={{ fontSize: 13, color: "var(--liff-secondary-text,#435068)", margin: 0 }}>
              {gpsStatusPresentation("idle").message}
            </p>
          </div>
          <LiffButton type="button" variant="primary" onClick={handleGpsCheckin}>{buttonLabel}</LiffButton>
        </div>
      )}

      {/* ── acquiring / submitting: ローディング ── */}
      {(status === "acquiring" || status === "submitting") && (
        <LiffLoadingState
          title={status === "acquiring" ? "現在地を確認しています" : "チェックインしています"}
          description="このまま少しだけお待ちください。"
        />
      )}

      {/* ── それ以外の状態: 統一カード ── */}
      {status !== "idle" && status !== "acquiring" && status !== "submitting" && (
        <LiffResultState
          variant={STATUS_VARIANT[status]}
          icon={STATUS_ICON[status]}
          title={pres.title ?? undefined}
          description={pres.message}
          primaryActionLabel={
            status === "scenario_not_started" ? "LINEのトークに戻る"
              : pres.showRetry ? (RETRY_LABEL[status] ?? "もう一度試す")
              : undefined
          }
          onPrimaryAction={
            status === "scenario_not_started" ? backToLine
              : pres.showRetry ? handleRetry
              : undefined
          }
        >
          {pres.showQrFallback && (
            <p style={{ fontSize: 12, color: "var(--liff-tertiary-text,#8C8C8C)", margin: 0, lineHeight: 1.6 }}>
              うまくいかない場合は、QR コードからのチェックインもお試しください。
            </p>
          )}
        </LiffResultState>
      )}
    </div>
  );
}

// 状態 → 見た目バリアント（denied/blocked は権限系として permission 表示）。
const STATUS_VARIANT: Record<GpsStatus, LiffStateVariant> = {
  idle: "info", acquiring: "loading", submitting: "loading",
  success: "success", out_of_range: "warning",
  denied: "permission", blocked: "permission",
  unavailable: "warning", timeout: "warning",
  scenario_not_started: "info", error: "error",
};
const STATUS_ICON: Partial<Record<GpsStatus, string>> = {
  out_of_range: "📍", denied: "🚫", blocked: "⚙️", unavailable: "📡", timeout: "⏳", scenario_not_started: "▶️", error: "🌊",
};
const RETRY_LABEL: Partial<Record<GpsStatus, string>> = {
  out_of_range: "もう一度確認する", blocked: "設定を変更したので再試行する",
};
