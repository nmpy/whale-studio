"use client";

// src/app/liff/page.tsx
// LIFF ロケーションチェックインページ（スマホファースト）

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
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

  // ── チェックイン送信（二重送信防止） ──
  const handleCheckin = useCallback(async () => {
    if (!lineUserId || !locationId || !workId) return;
    if (submittingRef.current) return;
    submittingRef.current = true;

    setState({ step: "submitting" });

    try {
      const res = await fetch("/api/liff/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line_user_id: lineUserId, location_id: locationId, work_id: workId }),
      });

      const json = await res.json();

      if (!json.success) {
        setState({ step: "error", code: "API_ERROR", message: json.error?.message ?? "チェックインに失敗しました" });
        return;
      }

      setState({ step: "result", result: json.data as CheckinResult });
    } catch {
      setState({ step: "error", code: "NETWORK", message: "通信エラーが発生しました。電波状況を確認してもう一度お試しください。" });
    } finally {
      submittingRef.current = false;
    }
  }, [lineUserId, locationId, workId]);

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

      {/* ── 初期化中 ── */}
      {state.step === "init" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 40, height: 40, border: "3px solid #e5e7eb", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
          <p style={{ fontSize: 14, color: "#6b7280" }}>{state.detail}</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ── エラー ── */}
      {state.step === "error" && (
        <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", padding: 32, maxWidth: 360, width: "100%", textAlign: "center" }}>
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

      {/* ── 確認 ── */}
      {state.step === "confirm" && (
        <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", padding: 32, maxWidth: 360, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📍</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>チェックイン</h1>
          <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 24 }}>この場所に来ましたか？</p>
          <button onClick={handleCheckin} style={btnPrimary}>チェックインする</button>
          <button onClick={handleClose} style={btnGhost}>キャンセル</button>
        </div>
      )}

      {/* ── 送信中 ── */}
      {state.step === "submitting" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 40, height: 40, border: "3px solid #e5e7eb", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
          <p style={{ fontSize: 14, color: "#6b7280" }}>チェックイン中...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ── 結果 ── */}
      {state.step === "result" && (
        <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", padding: 32, maxWidth: 360, width: "100%", textAlign: "center" }}>
          {state.result.status === "checked_in" ? (
            <>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>チェックイン完了</h2>
              <p style={{ fontSize: 14, color: "#6b7280" }}>{state.result.message}</p>
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
          ) : (
            <>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>{state.result.location_name}</h2>
              <p style={{ fontSize: 14, color: "#6b7280" }}>{state.result.message}</p>
              <CooldownTimer seconds={state.result.cooldown_remaining_seconds} />
            </>
          )}
          <button onClick={handleClose} style={btnGhost}>閉じる</button>
        </div>
      )}
    </div>
  );
}

/** クールダウンのカウントダウン表示 */
function CooldownTimer({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
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

// ── 共通スタイル ──
const btnPrimary: React.CSSProperties = {
  width: "100%", padding: "14px 0", background: "#2563eb", color: "#fff",
  border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600,
  cursor: "pointer", marginTop: 8, transition: "background 0.15s",
};
const btnGhost: React.CSSProperties = {
  width: "100%", padding: "12px 0", background: "#f3f4f6", color: "#374151",
  border: "none", borderRadius: 12, fontSize: 14, fontWeight: 500,
  cursor: "pointer", marginTop: 8, transition: "background 0.15s",
};

export default function LiffPage() {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ width: 40, height: 40, border: "3px solid #e5e7eb", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    }>
      <CheckinContent />
    </Suspense>
  );
}
