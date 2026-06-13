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
import { QrScanner } from "./_components/QrScanner";
import { recordLiffEvent } from "@/lib/liff-events";
import type { CheckinResult, CheckinMode } from "@/types";
import { LiffExperienceShell, LiffResultState, LiffLoadingState, LiffIconBadge } from "@/components/liff/experience";
import { LiffButton } from "@/components/liff/primitives/LiffButton";
import { resolveLiffErrorPresentation, resolveCheckinResultPresentation, LIFF_LOADING_COPY } from "@/lib/liff/copy";

type LiffStep =
  | { step: "init"; detail: string }
  | { step: "error"; code: string; message: string }
  | { step: "confirm"; mode: CheckinMode; locationName: string; targetLat?: number | null; targetLng?: number | null; radiusMeters?: number | null }
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

/** liff.state（= "/liff?work_id=...&location_id=..."）から指定キーの値を取り出す。
 *  LINE が primary redirect 前に元のクエリを liff.state に退避するケースで、
 *  resolveLiffStateRedirect による再遷移が走らなくても work_id/location_id を復元できるようにする。 */
function readFromLiffState(searchParams: { get(name: string): string | null }, key: string): string | null {
  const liffState = searchParams.get("liff.state");
  if (!liffState) return null;
  try {
    return new URL(liffState, "https://placeholder.invalid").searchParams.get(key);
  } catch {
    return null;
  }
}

function CheckinContent() {
  const searchParams = useSearchParams();
  // 直 query を最優先し、無ければ liff.state から復元する（直URL互換 + liff.state 形式の両対応）。
  const locationId = searchParams.get("location_id") ?? readFromLiffState(searchParams, "location_id");
  const workId = searchParams.get("work_id") ?? readFromLiffState(searchParams, "work_id");

  // SSR / 初回 render では window が無いので false 開始。
  // dispatch 用に "redirecting" 状態を持ち、redirect 中は画面を白くしすぎないようロード表示する。
  const [redirecting, setRedirecting] = useState(false);

  const [state, setState] = useState<LiffStep>({ step: "init", detail: "LIFF を初期化中..." });
  const [lineUserId, setLineUserId] = useState<string | null>(null);
  // slice 4: QR 導線 / イベント計測に必要な runtime コンテキスト。
  // verified（サーバー検証済み）と effective(lineUserId) を区別して保持する（#211 の方針を維持）。
  const [isLineUserVerified, setIsLineUserVerified] = useState(false);
  const [scanQrEnabled, setScanQrEnabled] = useState(false);
  const [isInClient, setIsInClient] = useState(false);
  const [oaId, setOaId] = useState<string | null>(null);
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
    // dispatch 中 / これから liff.state dispatch する場合は init を始めない
    // （redirect 直前に init が走って二重初期化・競合するのを防ぐ）。
    if (redirecting) return;
    if (resolveLiffStateRedirect()) return;

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
    // 失敗イベント (liff_init_failed) でも oaId を残せるよう try の外で保持する。
    let cfgOaId: string | null = null;

    (async () => {
      try {
        // ── per-OA liffId 解決（slice 1 の Runtime config を消費）──
        // Oa.liffId → NEXT_PUBLIC_LIFF_ID フォールバックはサーバー側 /api/liff/config で解決される。
        setState({ step: "init", detail: "LIFF 設定を確認中..." });
        let liffId: string | null = null;
        let cfgScanQr = false;
        try {
          const cfgRes = await fetch(`/api/liff/config?workId=${encodeURIComponent(workId)}&locationId=${encodeURIComponent(locationId)}`, { cache: "no-store" });
          const cfg = await cfgRes.json();
          liffId = cfg?.data?.liffId ?? null;
          cfgOaId = cfg?.data?.oaId ?? null;
          cfgScanQr = cfg?.data?.features?.scanQr === true;
        } catch { /* 解決失敗は下で NO_LIFF_ID として扱う */ }
        if (cancelled) return;
        setOaId(cfgOaId);
        setScanQrEnabled(cfgScanQr);
        if (!liffId) {
          // 白画面にせず、管理者向けに原因がわかる文言を出す。
          setState({
            step: "error",
            code: "NO_LIFF_ID",
            message: "LIFF ID が設定されていません。管理画面（設定 → LIFF設定）で LIFF ID を設定するか、環境変数 NEXT_PUBLIC_LIFF_ID を設定してください。",
          });
          return;
        }

        setState({ step: "init", detail: "LINE SDK を読み込み中..." });
        const liff = (await import("@line/liff")).default;

        setState({ step: "init", detail: "LINE に接続中..." });
        await liff.init({ liffId });
        const inClient = liff.isInClient();
        setIsInClient(inClient);
        recordLiffEvent({ workId, eventType: "liff_init_success", metadata: { oaId: cfgOaId, locationId, isInClient: inClient } });

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
        // verified（サーバー検証済み）と fallback（未検証の client 値）を**明確に区別**する。
        let verifiedLineUserId: string | null = null;
        let isLineUserVerified = false;
        try {
          const accessToken = liff.getAccessToken();
          const sres = await fetch("/api/liff/session", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ accessToken, workId, locationId }),
          });
          const sjson = await sres.json().catch(() => ({}));
          if (sjson?.success && sjson.data?.lineUserId) {
            verifiedLineUserId = sjson.data.lineUserId as string;
            isLineUserVerified = true;
          } else {
            console.warn("[LIFF] session verify failed — 未検証の client userId にフォールバック");
          }
        } catch (e) {
          console.warn("[LIFF] session API error — 未検証の client userId にフォールバック", e);
        }
        if (cancelled) return;

        setIsLineUserVerified(isLineUserVerified);
        recordLiffEvent({
          workId,
          eventType:  isLineUserVerified ? "session_success" : "session_failed",
          lineUserId: isLineUserVerified ? verifiedLineUserId : null,
          metadata:   { oaId: cfgOaId, locationId, isLineUserVerified },
        });

        // fallback は「未検証」の client 値。verified を最優先し、無ければ既存挙動維持のため
        // 未検証 client userId を使う（変数名・フラグで verified と区別して混同を防ぐ）。
        // TODO(認可強化 / 後続スライス): checkin API 側で isLineUserVerified を要求し、
        //   未検証セッションでの書き込みを拒否できる余地を残す。本スライスは体験維持を優先。
        const fallbackClientUserId = profile.userId; // ⚠ 未検証
        const effectiveLineUserId = isLineUserVerified ? verifiedLineUserId! : fallbackClientUserId;
        setLineUserId(effectiveLineUserId);

        const locData = locRes.success ? locRes.data : null;
        const mode: CheckinMode = (locData?.checkin_mode as CheckinMode) ?? "qr_only";
        const locationName = locData?.name ?? "この場所";
        // 地図表示用の目的地座標 / 範囲（additive。null 可。判定には使わない）
        const targetLat = typeof locData?.latitude === "number" ? locData.latitude : null;
        const targetLng = typeof locData?.longitude === "number" ? locData.longitude : null;
        const radiusMeters = typeof locData?.radius_meters === "number" ? locData.radius_meters : null;

        recordLiffEvent({
          workId,
          eventType:  "page_view",
          lineUserId: isLineUserVerified ? verifiedLineUserId : null,
          metadata:   { oaId: cfgOaId, locationId, mode, isLineUserVerified },
        });
        setState({ step: "confirm", mode, locationName, targetLat, targetLng, radiusMeters });
      } catch (err) {
        if (cancelled) return;
        console.error("[LIFF] init error:", err);
        const msg = err instanceof Error ? err.message : "";
        recordLiffEvent({ workId, eventType: "liff_init_failed", metadata: { oaId: cfgOaId, locationId, errorMessage: msg.slice(0, 200) } });
        // init 失敗の理由を分ける。LINE 内で開いていても起こりうる初期化エラーを
        // 「LINEで開いてください」と誤表示しない（外部ブラウザ判定は init 成功後の isInClient で行う）。
        if (msg.includes("INIT_FAILED") || msg.includes("INVALID_CONFIG") || /liff\s*id|liffId/i.test(msg)) {
          setState({
            step: "error",
            code: "LIFF_INIT_FAILED",
            message: "LIFF の初期化に失敗しました。LIFF ID と Endpoint URL（https://app.whale-studio.app/liff）の設定をご確認ください。",
          });
        } else {
          setState({
            step: "error",
            code: "LIFF_ERROR",
            message: "ページを開けませんでした。お手数ですが、LINEアプリ内のリンク（または現地のQRコード）から開き直してください。",
          });
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
      if (!json.success) {
        // 作品未開始は専用コードにして、次の行動（LINEトークで開始）が分かる文言を出す。
        const code = json.error?.code === "SCENARIO_NOT_STARTED" ? "SCENARIO_NOT_STARTED" : "API_ERROR";
        setState({ step: "error", code, message: json.error?.message ?? "チェックインに失敗しました" });
        return;
      }
      const result = json.data as CheckinResult;
      setState({ step: "result", result });
      if (result.status === "checked_in") setStampRefreshKey((k) => k + 1);
    } catch {
      setState({ step: "error", code: "NETWORK", message: "通信エラーが発生しました。" });
    } finally { submittingRef.current = false; }
  }, [lineUserId, locationId, workId]);

  // ── QR+GPS 二段階チェックイン ──
  // slice 3: 旧インライン実装（denied/unavailable の 2 分岐＋汎用文言・retry なし）を廃止し、
  // gps_only と同じ GpsCheckin コンポーネント（denied/blocked/unavailable/timeout/out_of_range/
  // retry/QR フォールバックの一貫 UX）に統一する。API の checkin_method は "qr_and_gps" を渡す。

  // ── GPS チェックイン結果（gps_only / qr_and_gps 共通） ──
  const handleGpsResult = useCallback((data: unknown) => {
    const result = data as CheckinResult;
    const ok = result.status === "checked_in";
    if (workId) recordLiffEvent({
      workId,
      eventType:  ok ? "gps_checkin_success" : "gps_checkin_failed",
      lineUserId: isLineUserVerified ? lineUserId : null,
      metadata:   { oaId, locationId, isLineUserVerified, status: result.status },
    });
    setState({ step: "result", result });
    if (ok) setStampRefreshKey((k) => k + 1);
  }, [workId, oaId, locationId, isLineUserVerified, lineUserId]);

  const handleClose = useCallback(async () => {
    try { const liff = (await import("@line/liff")).default; if (liff.isInClient()) { liff.closeWindow(); return; } } catch {}
    window.close();
  }, []);

  // dispatch 中はローディングだけ出して、誤って checkin ページが見えないようにする。
  if (redirecting) {
    return (
      <LiffExperienceShell showCredit={false}>
        <LiffLoadingState title="ページを読み込んでいます" description="このまま少しだけお待ちください。" />
      </LiffExperienceShell>
    );
  }

  const stampPanel =
    (state.step === "confirm" || state.step === "result") && lineUserId && workId
      ? <StampRallyProgressView workId={workId} lineUserId={lineUserId} refreshKey={stampRefreshKey} />
      : undefined;

  return (
    <LiffExperienceShell belowCard={stampPanel}>

      {state.step === "init" && (
        <LiffLoadingState title={LIFF_LOADING_COPY.title} description={state.detail || LIFF_LOADING_COPY.description} />
      )}

      {state.step === "error" && (() => {
        const p = resolveLiffErrorPresentation(state.code);
        return (
          <LiffResultState
            variant={p.variant}
            icon={p.icon}
            title={p.title}
            description={state.message}
            primaryActionLabel={p.closeLabel}
            onPrimaryAction={handleClose}
          />
        );
      })()}

      {state.step === "confirm" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
            <LiffIconBadge variant="info" icon="📍" />
            <h1 style={{ fontSize: 19, fontWeight: 700, color: "var(--liff-primary-text,#1F2329)", margin: 0 }}>チェックイン</h1>
            <p style={{ fontSize: 14, color: "var(--liff-secondary-text,#5B6168)", margin: 0 }}>{state.locationName}</p>
          </div>

          {/* ── qr_only ── */}
          {state.mode === "qr_only" && (
            <>
              <LiffButton type="button" variant="primary" onClick={handleQrCheckin}>チェックインする</LiffButton>
              {/* GPS 補助（任意） */}
              {lineUserId && locationId && workId && (
                <GpsCheckin locationId={locationId} workId={workId} lineUserId={lineUserId} locationName={state.locationName} targetLat={state.targetLat} targetLng={state.targetLng} radiusMeters={state.radiusMeters} onResult={handleGpsResult} />
              )}
            </>
          )}

          {/* ── gps_only ── */}
          {state.mode === "gps_only" && lineUserId && locationId && workId && (
            <GpsCheckin locationId={locationId} workId={workId} lineUserId={lineUserId} locationName={state.locationName} targetLat={state.targetLat} targetLng={state.targetLng} radiusMeters={state.radiusMeters} onResult={handleGpsResult} />
          )}

          {/* ── qr_and_gps ── */}
          {state.mode === "qr_and_gps" && lineUserId && locationId && workId && (
            <>
              <div style={{ padding: "12px 14px", background: "#eef6fd", borderRadius: 12, fontSize: 13, color: "var(--liff-secondary-text,#435068)", lineHeight: 1.7 }}>
                このスポットは QR と位置情報の二段階で進みます。下のボタンを押すと現在地を確認してチェックインします。
              </div>
              <GpsCheckin
                locationId={locationId}
                workId={workId}
                lineUserId={lineUserId}
                locationName={state.locationName}
                targetLat={state.targetLat}
                targetLng={state.targetLng}
                radiusMeters={state.radiusMeters}
                checkinMethod="qr_and_gps"
                buttonLabel="現在地を確認してチェックイン"
                onResult={handleGpsResult}
              />
            </>
          )}

          {/* ── QR 読み取り導線（slice 4） ──
              scanQrEnabled=false の OA では導線自体を出さない（白画面にしない＝そもそも描画しない）。 */}
          {scanQrEnabled && workId && lineUserId && (
            <QrScanner
              workId={workId}
              oaId={oaId}
              locationId={locationId}
              mode={state.mode}
              verifiedLineUserId={isLineUserVerified ? lineUserId : null}
              isLineUserVerified={isLineUserVerified}
              scanQrEnabled={scanQrEnabled}
              isInClient={isInClient}
            />
          )}

          <LiffButton type="button" variant="ghost" size="sm" onClick={handleClose}>キャンセル</LiffButton>
        </div>
      )}

      {state.step === "gps_acquiring" && (
        <LiffLoadingState title="現在地を確認しています" description="このまま少しだけお待ちください。" />
      )}
      {state.step === "submitting" && (
        <LiffLoadingState title="チェックインしています" description="このまま少しだけお待ちください。" />
      )}

      {state.step === "result" && (() => {
        const r = state.result;
        const p = resolveCheckinResultPresentation(r.status);
        return (
          <LiffResultState
            variant={p.variant}
            icon={p.icon}
            title={r.status === "cooldown" && r.location_name ? r.location_name : p.title}
            description={r.message}
            primaryActionLabel="閉じる"
            onPrimaryAction={handleClose}
          >
            {r.status === "checked_in" && (
              <>
                {r.stamp && (
                  <div style={{ width: "100%", padding: "10px 14px", background: r.stamp.newly_collected ? "#e7f7ee" : "#f6f8fa", borderRadius: 12, fontSize: 13 }}>
                    {r.stamp.newly_collected
                      ? <span style={{ color: "#0f9d58", fontWeight: 700 }}>新しいスタンプを獲得！（{r.stamp.completed_count}/{r.stamp.total_count}）</span>
                      : <span style={{ color: "var(--liff-secondary-text,#5B6168)" }}>達成済み（{r.stamp.completed_count}/{r.stamp.total_count}）</span>}
                    {r.stamp.is_completed && <div style={{ marginTop: 4, fontWeight: 700, color: "#0f9d58" }}>全スポットコンプリート！</div>}
                  </div>
                )}
                {r.distance_meters !== undefined && (
                  <p style={{ fontSize: 11, color: "var(--liff-tertiary-text,#8C8C8C)", margin: 0 }}>距離: 約{r.distance_meters}m</p>
                )}
                {r.transition && (
                  <div style={{ width: "100%", padding: "8px 12px", background: "#eef6fd", borderRadius: 12, fontSize: 13, color: "#2563eb" }}>次のフェーズ: {r.transition.name}</div>
                )}
              </>
            )}
            {r.status === "cooldown" && <CooldownTimer seconds={r.cooldown_remaining_seconds} />}
          </LiffResultState>
        );
      })()}
    </LiffExperienceShell>
  );
}

function CooldownTimer({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => { if (remaining <= 0) return; const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000); return () => clearInterval(t); }, [remaining]);
  if (remaining <= 0) return <p style={{ fontSize: 13, color: "#0f9d58", fontWeight: 600, margin: 0 }}>再チェックインできます</p>;
  return <p style={{ fontSize: 13, color: "var(--liff-tertiary-text,#8C8C8C)", margin: 0 }}>再チェックインまで: <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span></p>;
}

export default function LiffPage() {
  return (
    <Suspense fallback={<LiffExperienceShell showCredit={false}><LiffLoadingState /></LiffExperienceShell>}>
      <CheckinContent />
    </Suspense>
  );
}
