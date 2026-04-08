"use client";

// src/app/liff/page.tsx
// LIFF ロケーションチェックインページ（スマホファースト）
// QR（メイン導線）+ GPS（補助導線）+ スタンプラリー進捗

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { GpsCheckin } from "./_gps-checkin";
import { StampRallyProgressView } from "./_stamp-rally-progress";
import type { CheckinResult } from "@/types";

type LiffStep =
  | { step: "init"; detail: string }
  | { step: "error"; code: string; message: string }
  | { step: "confirm" }
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

  // ── LIFF 初期化 ──
  useEffect(() => {
    if (!locationId || !workId) {
      const missing = [!locationId && "location_id", !workId && "work_id"].filter(Boolean).join(", ");
      setState({ step: "error", code: "MISSING_PARAMS", message: `URLパラメータが不足しています: ${missing}` });
      return;
    }

    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) {
      setState({ step: "error", code: "NO_LIFF_ID", message: "システム設定エラーが発生しました（LIFF ID 未設定）" });
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

        setState({ step: "init", detail: "プロフィールを取得中..." });
        const profile = await liff.getProfile();
        if (cancelled) return;
        setLineUserId(profile.userId);
        setState({ step: "confirm" });
      } catch (err) {
        if (cancelled) return;
        console.error("[LIFF] init error:", err);
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("INIT_FAILED") || msg.includes("INVALID_CONFIG")) {
          setState({ step: "error", code: "LIFF_INIT_FAILED", message: "LIFF の初期化に失敗しました。URLが正しいか確認してください。" });
        } else {
          setState({ step: "error", code: "NOT_IN_LINE", message: "LINE アプリ内でこのページを開いてください。QR コードを LINE で読み取ってください。" });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [locationId, workId]);

  // ── QR チェックイン送信 ──
  const handleCheckin = useCallback(async () => {
    if (!lineUserId || !locationId || !workId) return;
    if (submittingRef.current) return;
    submittingRef.current = true;

    setState({ step: "submitting" });

    try {
      const res = await fetch("/api/liff/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_user_id: lineUserId,
          location_id: locationId,
          work_id: workId,
          checkin_method: "qr",
        }),
      });

      const json = await res.json();

      if (!json.success) {
        setState({ step: "error", code: "API_ERROR", message: json.error?.message ?? "チェックインに失敗しました" });
        return;
      }

      const result = json.data as CheckinResult;
      setState({ step: "result", result });
      if (result.status === "checked_in") setStampRefreshKey((k) => k + 1);
    } catch {
      setState({ step: "error", code: "NETWORK", message: "通信エラーが発生しました。電波状況を確認してもう一度お試しください。" });
    } finally {
      submittingRef.current = false;
    }
  }, [lineUserId, locationId, workId]);

  // ── GPS チェックイン結果 ──
  const handleGpsResult = useCallback((data: unknown) => {
    const result = data as CheckinResult;
    setState({ step: "result", result });
    if (result.status === "checked_in") setStampRefreshKey((k) => k + 1);
  }, []);

  // ── LIFF ウィンドウを閉じる ──
  const handleClose = useCallback(async () => {
    try {
      const liff = (await import("@line/liff")).default;
      if (liff.isInClient()) { liff.closeWindow(); return; }
    } catch { /* ignore */ }
    window.close();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "24px" }}>

      {state.step === "init" && (
        <div style={{ textAlign: "center" }}>
          <Spinner />
          <p style={{ fontSize: 14, color: "#6b7280" }}>{state.detail}</p>
        </div>
      )}

      {state.step === "error" && (
        <div style={cardStyle}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>
            {state.code === "NOT_IN_LINE" ? "📱" : state.code === "NETWORK" ? "📡" : "⚠️"}
          </div>
          <p style={{ fontWeight: 600, fontSize: 16, color: "#111827", marginBottom: 8 }}>
            {state.code === "NOT_IN_LINE" ? "LINE で開いてください" : "エラーが発生しました"}
          </p>
          <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.7 }}>{state.message}</p>
          <button onClick={handleClose} style={btnGhost}>閉じる</button>
        </div>
      )}

      {state.step === "confirm" && (
        <>
          <div style={cardStyle}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📍</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>チェックイン</h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 24 }}>この場所に来ましたか？</p>
            <button onClick={handleCheckin} style={btnPrimary}>チェックインする</button>

            {/* GPS 補助導線 */}
            {lineUserId && locationId && workId && (
              <GpsCheckin
                locationId={locationId}
                workId={workId}
                lineUserId={lineUserId}
                onResult={handleGpsResult}
              />
            )}

            <button onClick={handleClose} style={btnGhost}>キャンセル</button>
          </div>

          {/* スタンプ進捗（confirm時に表示） */}
          {lineUserId && workId && (
            <StampRallyProgressView workId={workId} lineUserId={lineUserId} refreshKey={stampRefreshKey} />
          )}
        </>
      )}

      {state.step === "submitting" && (
        <div style={{ textAlign: "center" }}>
          <Spinner />
          <p style={{ fontSize: 14, color: "#6b7280" }}>チェックイン中...</p>
        </div>
      )}

      {state.step === "result" && (
        <>
          <div style={cardStyle}>
            {state.result.status === "checked_in" ? (
              <>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>チェックイン完了</h2>
                <p style={{ fontSize: 14, color: "#6b7280" }}>{state.result.message}</p>

                {/* スタンプ情報 */}
                {state.result.stamp && (
                  <div style={{ marginTop: 12, padding: "10px 14px", background: state.result.stamp.newly_collected ? "#f0fdf4" : "#f9fafb", borderRadius: 8, fontSize: 13 }}>
                    {state.result.stamp.newly_collected ? (
                      <span style={{ color: "#16a34a", fontWeight: 600 }}>
                        新しいスタンプを獲得しました！（{state.result.stamp.completed_count}/{state.result.stamp.total_count}）
                      </span>
                    ) : (
                      <span style={{ color: "#6b7280" }}>
                        このスポットは達成済みです（{state.result.stamp.completed_count}/{state.result.stamp.total_count}）
                      </span>
                    )}
                    {state.result.stamp.is_completed && (
                      <div style={{ marginTop: 4, fontWeight: 700, color: "#16a34a" }}>
                        全スポットコンプリート！
                      </div>
                    )}
                  </div>
                )}

                {/* GPS 距離情報 */}
                {state.result.distance_meters !== undefined && (
                  <p style={{ marginTop: 8, fontSize: 11, color: "#9ca3af" }}>
                    距離: 約{state.result.distance_meters}m（許容: {state.result.radius_meters}m）
                  </p>
                )}

                {state.result.transition && (
                  <div style={{ marginTop: 12, padding: "8px 12px", background: "#eff6ff", borderRadius: 8, fontSize: 13, color: "#1d4ed8" }}>
                    次のフェーズ: {state.result.transition.name}
                  </div>
                )}
                {state.result.flags_applied && Object.keys(state.result.flags_applied).length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af" }}>
                    フラグ更新: {Object.entries(state.result.flags_applied).map(([k, v]) => `${k}=${String(v)}`).join(", ")}
                  </div>
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
              // out_of_range
              <>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📏</div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>範囲外です</h2>
                <p style={{ fontSize: 14, color: "#6b7280" }}>{state.result.message}</p>
              </>
            )}
            <button onClick={handleClose} style={btnGhost}>閉じる</button>
          </div>

          {/* スタンプ進捗（result時にも表示） */}
          {lineUserId && workId && (
            <StampRallyProgressView workId={workId} lineUserId={lineUserId} refreshKey={stampRefreshKey} />
          )}
        </>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <>
      <div style={{ width: 40, height: 40, border: "3px solid #e5e7eb", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

function CooldownTimer({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(timer);
  }, [remaining]);

  if (remaining <= 0) {
    return <p style={{ marginTop: 12, fontSize: 13, color: "#16a34a", fontWeight: 600 }}>再チェックインできます</p>;
  }

  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return (
    <p style={{ marginTop: 12, fontSize: 13, color: "#9ca3af" }}>
      再チェックインまで: <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{m}:{String(s).padStart(2, "0")}</span>
    </p>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
  padding: 32, maxWidth: 360, width: "100%", textAlign: "center",
};
const btnPrimary: React.CSSProperties = {
  width: "100%", padding: "14px 0", background: "#2563eb", color: "#fff",
  border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600,
  cursor: "pointer", marginTop: 8,
};
const btnGhost: React.CSSProperties = {
  width: "100%", padding: "12px 0", background: "#f3f4f6", color: "#374151",
  border: "none", borderRadius: 12, fontSize: 14, fontWeight: 500,
  cursor: "pointer", marginTop: 8,
};

export default function LiffPage() {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <Spinner />
      </div>
    }>
      <CheckinContent />
    </Suspense>
  );
}
