"use client";

// src/app/liff/page.tsx
// LIFF ロケーションチェックインページ（スマホファースト）
// checkin_mode に応じた UI 出し分け:
//   qr_only    → QR ボタンのみ
//   gps_only   → GPS チェックイン UI
//   qr_and_gps → QR + GPS 二段階（位置情報取得 → チェックイン）

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { GpsCheckin } from "./_gps-checkin";
import { StampRallyProgressView } from "./_stamp-rally-progress";
import type { CheckinResult, CheckinMode } from "@/types";

type LiffStep =
  | { step: "init"; detail: string }
  | { step: "error"; code: string; message: string }
  | { step: "confirm"; mode: CheckinMode; locationName: string }
  | { step: "gps_acquiring" }
  | { step: "submitting" }
  | { step: "result"; result: CheckinResult };

function CheckinContent() {
  const searchParams = useSearchParams();
  const locationId = searchParams.get("location_id");
  const workId = searchParams.get("work_id");

  const [state, setState] = useState<LiffStep>({ step: "init", detail: "LIFF を初期化中..." });
  const [lineUserId, setLineUserId] = useState<string | null>(null);
  const [stampRefreshKey, setStampRefreshKey] = useState(0);
  const submittingRef = useRef(false);

  // ── LIFF 初期化 + ロケーション情報取得 ──
  useEffect(() => {
    if (!locationId || !workId) {
      const missing = [!locationId && "location_id", !workId && "work_id"].filter(Boolean).join(", ");
      setState({ step: "error", code: "MISSING_PARAMS", message: `URLパラメータが不足しています: ${missing}` });
      return;
    }
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) {
      setState({ step: "error", code: "NO_LIFF_ID", message: "システム設定エラーが発生しました" });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setState({ step: "init", detail: "LINE SDK を読み込み中..." });
        const liff = (await import("@line/liff")).default;

        setState({ step: "init", detail: "LINE に接続中..." });
        await liff.init({ liffId });

        if (!liff.isLoggedIn()) {
          setState({ step: "init", detail: "LINE ログインへ移動します..." });
          liff.login({ redirectUri: window.location.href });
          return;
        }

        setState({ step: "init", detail: "情報を取得中..." });
        const [profile, locRes] = await Promise.all([
          liff.getProfile(),
          fetch(`/api/liff/location-info?location_id=${locationId}`).then((r) => r.json()),
        ]);
        if (cancelled) return;

        setLineUserId(profile.userId);

        const locData = locRes.success ? locRes.data : null;
        const mode: CheckinMode = (locData?.checkin_mode as CheckinMode) ?? "qr_only";
        const locationName = locData?.name ?? "この場所";

        setState({ step: "confirm", mode, locationName });
      } catch (err) {
        if (cancelled) return;
        console.error("[LIFF] init error:", err);
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("INIT_FAILED") || msg.includes("INVALID_CONFIG")) {
          setState({ step: "error", code: "LIFF_INIT_FAILED", message: "LIFF の初期化に失敗しました。" });
        } else {
          setState({ step: "error", code: "NOT_IN_LINE", message: "LINE アプリ内でこのページを開いてください。" });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [locationId, workId]);

  // ── QR チェックイン（qr_only 用） ──
  const handleQrCheckin = useCallback(async () => {
    if (!lineUserId || !locationId || !workId || submittingRef.current) return;
    submittingRef.current = true;
    setState({ step: "submitting" });

    try {
      const res = await fetch("/api/liff/checkin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line_user_id: lineUserId, location_id: locationId, work_id: workId, checkin_method: "qr" }),
      });
      const json = await res.json();
      if (!json.success) { setState({ step: "error", code: "API_ERROR", message: json.error?.message ?? "チェックインに失敗しました" }); return; }
      const result = json.data as CheckinResult;
      setState({ step: "result", result });
      if (result.status === "checked_in") setStampRefreshKey((k) => k + 1);
    } catch {
      setState({ step: "error", code: "NETWORK", message: "通信エラーが発生しました。" });
    } finally { submittingRef.current = false; }
  }, [lineUserId, locationId, workId]);

  // ── QR+GPS 二段階チェックイン ──
  const handleQrAndGpsCheckin = useCallback(async () => {
    if (!lineUserId || !locationId || !workId || submittingRef.current) return;
    submittingRef.current = true;
    setState({ step: "gps_acquiring" });

    try {
      // GPS 取得
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      });

      setState({ step: "submitting" });
      const res = await fetch("/api/liff/checkin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_user_id: lineUserId, location_id: locationId, work_id: workId,
          checkin_method: "qr_and_gps", lat: position.coords.latitude, lng: position.coords.longitude,
        }),
      });
      const json = await res.json();
      if (!json.success) { setState({ step: "error", code: "API_ERROR", message: json.error?.message ?? "チェックインに失敗しました" }); return; }
      const result = json.data as CheckinResult;
      setState({ step: "result", result });
      if (result.status === "checked_in") setStampRefreshKey((k) => k + 1);
    } catch (err) {
      if (err instanceof GeolocationPositionError) {
        // クライアント失敗ログ
        fetch("/api/liff/checkin-attempt", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ work_id: workId, location_id: locationId, line_user_id: lineUserId, status: err.code === err.PERMISSION_DENIED ? "permission_denied" : "gps_unavailable" }),
        }).catch(() => {});

        const msg = err.code === err.PERMISSION_DENIED
          ? "位置情報の利用が許可されていません。端末の設定から許可してください。"
          : "位置情報を取得できませんでした。";
        setState({ step: "error", code: "GPS_FAILED", message: msg });
      } else {
        setState({ step: "error", code: "NETWORK", message: "通信エラーが発生しました。" });
      }
    } finally { submittingRef.current = false; }
  }, [lineUserId, locationId, workId]);

  // ── GPS チェックイン結果（gps_only 用） ──
  const handleGpsResult = useCallback((data: unknown) => {
    const result = data as CheckinResult;
    setState({ step: "result", result });
    if (result.status === "checked_in") setStampRefreshKey((k) => k + 1);
  }, []);

  const handleClose = useCallback(async () => {
    try { const liff = (await import("@line/liff")).default; if (liff.isInClient()) { liff.closeWindow(); return; } } catch {}
    window.close();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "24px" }}>

      {state.step === "init" && <div style={{ textAlign: "center" }}><Spinner /><p style={{ fontSize: 14, color: "#6b7280" }}>{state.detail}</p></div>}

      {state.step === "error" && (
        <div style={cardStyle}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{state.code === "NOT_IN_LINE" ? "📱" : state.code === "GPS_FAILED" ? "📍" : "⚠️"}</div>
          <p style={{ fontWeight: 600, fontSize: 16, color: "#111827", marginBottom: 8 }}>
            {state.code === "NOT_IN_LINE" ? "LINE で開いてください" : state.code === "GPS_FAILED" ? "位置情報を取得できません" : "エラーが発生しました"}
          </p>
          <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.7 }}>{state.message}</p>
          <button onClick={handleClose} style={btnGhost}>閉じる</button>
        </div>
      )}

      {state.step === "confirm" && (
        <>
          <div style={cardStyle}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📍</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>チェックイン</h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 20 }}>{state.locationName}</p>

            {/* ── qr_only ── */}
            {state.mode === "qr_only" && (
              <>
                <button onClick={handleQrCheckin} style={btnPrimary}>チェックインする</button>
                {/* GPS 補助（任意） */}
                {lineUserId && locationId && workId && (
                  <GpsCheckin locationId={locationId} workId={workId} lineUserId={lineUserId} locationName={state.step === "confirm" ? state.locationName : undefined} onResult={handleGpsResult} />
                )}
              </>
            )}

            {/* ── gps_only ── */}
            {state.mode === "gps_only" && lineUserId && locationId && workId && (
              <GpsCheckin locationId={locationId} workId={workId} lineUserId={lineUserId} locationName={state.step === "confirm" ? state.locationName : undefined} onResult={handleGpsResult} />
            )}

            {/* ── qr_and_gps ── */}
            {state.mode === "qr_and_gps" && (
              <>
                <div style={{ padding: "10px 14px", background: "#eff6ff", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "#1d4ed8", lineHeight: 1.6 }}>
                  このスポットは QR + 位置情報の二段階チェックインが必要です。ボタンを押すと位置情報を確認してチェックインします。
                </div>
                <button onClick={handleQrAndGpsCheckin} style={btnPrimary}>
                  位置情報を確認してチェックイン
                </button>
              </>
            )}

            <button onClick={handleClose} style={btnGhost}>キャンセル</button>
          </div>

          {lineUserId && workId && <StampRallyProgressView workId={workId} lineUserId={lineUserId} refreshKey={stampRefreshKey} />}
        </>
      )}

      {state.step === "gps_acquiring" && <div style={{ textAlign: "center" }}><Spinner /><p style={{ fontSize: 14, color: "#6b7280" }}>位置情報を取得中...</p></div>}
      {state.step === "submitting" && <div style={{ textAlign: "center" }}><Spinner /><p style={{ fontSize: 14, color: "#6b7280" }}>チェックイン中...</p></div>}

      {state.step === "result" && (
        <>
          <div style={cardStyle}>
            {state.result.status === "checked_in" ? (
              <>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>チェックイン完了</h2>
                <p style={{ fontSize: 14, color: "#6b7280" }}>{state.result.message}</p>
                {state.result.stamp && (
                  <div style={{ marginTop: 12, padding: "10px 14px", background: state.result.stamp.newly_collected ? "#f0fdf4" : "#f9fafb", borderRadius: 8, fontSize: 13 }}>
                    {state.result.stamp.newly_collected
                      ? <span style={{ color: "#16a34a", fontWeight: 600 }}>新しいスタンプを獲得！（{state.result.stamp.completed_count}/{state.result.stamp.total_count}）</span>
                      : <span style={{ color: "#6b7280" }}>達成済み（{state.result.stamp.completed_count}/{state.result.stamp.total_count}）</span>}
                    {state.result.stamp.is_completed && <div style={{ marginTop: 4, fontWeight: 700, color: "#16a34a" }}>全スポットコンプリート！</div>}
                  </div>
                )}
                {state.result.distance_meters !== undefined && (
                  <p style={{ marginTop: 8, fontSize: 11, color: "#9ca3af" }}>距離: 約{state.result.distance_meters}m</p>
                )}
                {state.result.transition && (
                  <div style={{ marginTop: 12, padding: "8px 12px", background: "#eff6ff", borderRadius: 8, fontSize: 13, color: "#1d4ed8" }}>次のフェーズ: {state.result.transition.name}</div>
                )}
              </>
            ) : state.result.status === "cooldown" ? (
              <>
                <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>{state.result.location_name}</h2>
                <p style={{ fontSize: 14, color: "#6b7280" }}>{state.result.message}</p>
                <CooldownTimer seconds={state.result.cooldown_remaining_seconds} />
              </>
            ) : (
              <>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📏</div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>範囲外です</h2>
                <p style={{ fontSize: 14, color: "#6b7280" }}>{state.result.message}</p>
              </>
            )}
            <button onClick={handleClose} style={btnGhost}>閉じる</button>
          </div>
          {lineUserId && workId && <StampRallyProgressView workId={workId} lineUserId={lineUserId} refreshKey={stampRefreshKey} />}
        </>
      )}
    </div>
  );
}

function Spinner() {
  return <><div style={{ width: 40, height: 40, border: "3px solid #e5e7eb", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} /><style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style></>;
}

function CooldownTimer({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => { if (remaining <= 0) return; const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000); return () => clearInterval(t); }, [remaining]);
  if (remaining <= 0) return <p style={{ marginTop: 12, fontSize: 13, color: "#16a34a", fontWeight: 600 }}>再チェックインできます</p>;
  return <p style={{ marginTop: 12, fontSize: 13, color: "#9ca3af" }}>再チェックインまで: <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span></p>;
}

const cardStyle: React.CSSProperties = { background: "#fff", borderRadius: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", padding: 32, maxWidth: 360, width: "100%", textAlign: "center" };
const btnPrimary: React.CSSProperties = { width: "100%", padding: "14px 0", background: "#2563eb", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 8 };
const btnGhost: React.CSSProperties = { width: "100%", padding: "12px 0", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 500, cursor: "pointer", marginTop: 8 };

export default function LiffPage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}><Spinner /></div>}>
      <CheckinContent />
    </Suspense>
  );
}
