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

// LIFF SDK は https://liff.line.me/{LIFF_ID}/<path> で開かれたとき、
// <path> 部分を `liff.state` クエリパラメータとして endpoint URL (= 本ルート /liff) に付加する。
// 例: https://liff.line.me/{ID}/work/X/pages/Y
//   → https://<endpoint>/liff?liff.state=%2Fwork%2FX%2Fpages%2FY
// 通常は LIFF SDK の `liff.init()` が liff.state を読んで自動リダイレクトしてくれるが、
// 本ページは「チェックイン専用ページ」として location_id / work_id が無いと early return しており
// liff.init() に到達しないため、ここで「dispatcher」として手動でリダイレクトを行う。
//
// この処理を最優先で実行することで、/liff (チェックイン) と /liff/work/... (プレイヤー) を
// 明確に分離する。チェックインへの誤誘導を防ぐため、liff.state があれば必ず先にリダイレクトする。
function resolveLiffStateRedirect(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const liffState = url.searchParams.get("liff.state");
  if (!liffState) return null;

  // 空文字 / ルート "/" は無限ループするだけなので無視する。
  if (liffState === "" || liffState === "/") return null;

  // liff.state は通常 "/work/X/pages/Y" のような絶対パス文字列。
  // 万一相対パス文字列で来ても先頭に / を補う。
  const subPath = liffState.startsWith("/") ? liffState : `/${liffState}`;

  // すでに /liff で始まる(無限ループ防止)場合はそのまま使う。それ以外は /liff を前置。
  const targetPath = subPath.startsWith("/liff") ? subPath : `/liff${subPath}`;

  // 自ルート同一(= /liff)への redirect は無視 (loop 防止)
  // pathname の trailing slash を正規化して比較する
  const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
  const normalizedTarget = targetPath.replace(/\/+$/, "") || "/";
  if (normalizedTarget === currentPath) return null;

  // 残りのクエリ(liff.state 以外)とハッシュは保持する。
  url.searchParams.delete("liff.state");
  const remainingQuery = url.searchParams.toString();
  const hash = window.location.hash;
  return `${targetPath}${remainingQuery ? `?${remainingQuery}` : ""}${hash}`;
}

function CheckinContent() {
  const searchParams = useSearchParams();
  const locationId = searchParams.get("location_id");
  const workId = searchParams.get("work_id");

  // SSR / 初回 render では window が無いので false 開始。
  // dispatch 用に "redirecting" 状態を持ち、redirect 中は画面を白くしすぎないようロード表示する。
  const [redirecting, setRedirecting] = useState(false);

  const [state, setState] = useState<LiffStep>({ step: "init", detail: "LIFF を初期化中..." });
  const [lineUserId, setLineUserId] = useState<string | null>(null);
  const [stampRefreshKey, setStampRefreshKey] = useState(0);
  const submittingRef = useRef(false);

  // ── 最優先: LIFF deep link の dispatch (liff.state クエリを処理) ──
  // useEffect 内ではなく、最初の render 後すぐにリダイレクトしたいので
  // ここで判定して即座に navigate する。
  useEffect(() => {
    const redirectTo = resolveLiffStateRedirect();
    if (redirectTo) {
      setRedirecting(true);
      // replace で履歴に残さない (戻るボタンで /liff?liff.state= に戻れないように)
      window.location.replace(redirectTo);
    }
  }, []);

  // ── LIFF 初期化 + ロケーション情報取得 ──
  useEffect(() => {
    // dispatch 中は何もしない
    if (redirecting) return;

    if (!locationId || !workId) {
      // ここは「チェックイン専用ページ」(ロケーション QR コードから開く想定)。
      // location_id / work_id が無い場合は、利用者が誤ってこの URL を開いたと判断し、
      // 「LIFFページを表示する URL ではない」旨の案内に切り替える。
      // 本ルート (/liff) を「LIFFページ全体エラー」と誤解させないため。
      setState({
        step: "error",
        code: "MISSING_PARAMS",
        message: "このページはチェックイン用のリンクです。LINEで送られてきたボタンや、現地のQRコードから開いてください。LIFFページを開きたい場合は、編集画面に表示される LIFFページ URL を使ってください。",
      });
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        // ── per-OA liffId 解決（slice 1 の Runtime config を消費）──
        // Oa.liffId → NEXT_PUBLIC_LIFF_ID フォールバックはサーバー側 /api/liff/config で解決される。
        setState({ step: "init", detail: "LIFF 設定を確認中..." });
        let liffId: string | null = null;
        try {
          const cfgRes = await fetch(`/api/liff/config?workId=${encodeURIComponent(workId)}&locationId=${encodeURIComponent(locationId)}`, { cache: "no-store" });
          const cfg = await cfgRes.json();
          liffId = cfg?.data?.liffId ?? null;
        } catch { /* 解決失敗は下で NO_LIFF_ID として扱う */ }
        if (cancelled) return;
        if (!liffId) {
          // 白画面にせず、管理者向けに原因がわかる文言を出す。
          setState({
            step: "error",
            code: "NO_LIFF_ID",
            message: "LIFF ID が設定されていません。管理画面（アカウント設定 → LIFF設定）で LIFF ID を設定するか、環境変数 NEXT_PUBLIC_LIFF_ID を設定してください。",
          });
          return;
        }

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

        // ── サーバー検証セッション確立（lineUserId をサーバーで取り直す）──
        // フロントの profile.userId は信用せず、accessToken を /api/liff/session で検証する。
        // 検証に失敗してもチェックイン体験を止めないよう、client profile.userId にフォールバック
        // （その場合は管理者ログに残す）。完全な認可強化は後続スライスで checkin API 側に適用。
        let resolvedUserId = profile.userId;
        try {
          const accessToken = liff.getAccessToken();
          const sres = await fetch("/api/liff/session", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ accessToken, workId, locationId }),
          });
          const sjson = await sres.json().catch(() => ({}));
          if (sjson?.success && sjson.data?.lineUserId) {
            resolvedUserId = sjson.data.lineUserId as string;
          } else {
            console.warn("[LIFF] session verify failed — client userId にフォールバック");
          }
        } catch (e) {
          console.warn("[LIFF] session API error — client userId にフォールバック", e);
        }
        if (cancelled) return;

        setLineUserId(resolvedUserId);

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
  }, [locationId, workId, redirecting]);

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

  // dispatch 中は spinner だけ出して、誤って checkin ページが見えないようにする。
  if (redirecting) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "24px" }}>
        <div style={{ textAlign: "center" }}>
          <Spinner />
          <p style={{ fontSize: 14, color: "#6b7280" }}>ページを読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "24px" }}>

      {state.step === "init" && <div style={{ textAlign: "center" }}><Spinner /><p style={{ fontSize: 14, color: "#6b7280" }}>{state.detail}</p></div>}

      {state.step === "error" && (
        <div style={cardStyle}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>
            {state.code === "NOT_IN_LINE" ? "📱"
              : state.code === "GPS_FAILED" ? "📍"
              : state.code === "MISSING_PARAMS" ? "🔗"
              : "⚠️"}
          </div>
          <p style={{ fontWeight: 600, fontSize: 16, color: "#111827", marginBottom: 8 }}>
            {state.code === "NOT_IN_LINE" ? "LINE で開いてください"
              : state.code === "GPS_FAILED" ? "位置情報を取得できません"
              : state.code === "MISSING_PARAMS" ? "このページはチェックイン用です"
              : "エラーが発生しました"}
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
