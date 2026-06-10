"use client";

// src/app/liff/_components/QrScanner.tsx
//
// LIFF Runtime 内の QR 読み取り導線（slice 4 + QR 成功メッセージ follow-up PR 2/2）。
//
// ■ できること
//   - liff.scanCodeV2 が使える環境でのみ「QR を読み取る」ボタンを表示
//   - LIFF 外ブラウザ / scanCodeV2 非対応 / Scan QR 未有効 では、白画面にせず案内を表示
//   - 読み取り成功後、サーバー（POST /api/liff/qr/complete）に accessToken + QR 値を送り、
//     サーバー側で検証・解決・LINE push 送信させる（結果を UI 状態として表示）
//   - 状態: idle / scanning / sending / sent / already_processed / unmatched /
//           message_not_configured / cancelled / failed
//
// ■ セキュリティ / 方針
//   - 送信対象・本人確定はサーバーが accessToken を再検証して決める。フロントの userId は使わない。
//   - accessToken / verified session が無い場合は API を呼ばない（= 送信しない）。
//   - cancel 時は API を呼ばない。QR 値は UI 表示でも truncate する。
//   - QR 値の解決・送信メッセージ決定はすべてサーバー（DB の正規データ）側。
//   - 計測はスキャンのライフサイクル（cancel/failed/送信不可時の success）をクライアントから記録する。
//     送信結果（qr_message_send_*）はサーバーが正本として記録する（二重計上を避ける）。

import { useCallback, useState } from "react";
import { recordLiffEvent } from "@/lib/liff-events";
import {
  qrScanGuidance, truncateQrValue, isScanCancelError,
  interpretQrComplete, type QrSendOutcome,
} from "@/lib/liff/qr";
import { LiffResultState, LiffLoadingState, type LiffStateVariant } from "@/components/liff/experience";
import { LiffButton } from "@/components/liff/primitives/LiffButton";

type QrState =
  | "idle" | "scanning" | "sending"
  | "sent" | "already_processed" | "unmatched" | "message_not_configured"
  | "cancelled" | "failed";

interface QrScannerProps {
  workId: string;
  oaId?:        string | null;
  locationId?:  string | null;
  pageId?:      string | null;
  mode?:        string;
  /** サーバー検証済み lineUserId（未検証なら null）。 */
  verifiedLineUserId: string | null;
  isLineUserVerified: boolean;
  /** OA 設定 Oa.liffScanQrEnabled（config features.scanQr）。 */
  scanQrEnabled: boolean;
  /** liff.isInClient()。 */
  isInClient: boolean;
}

/** スキャンごとの idempotency key（サーバーの二重送信抑止に渡す）。 */
function genScanId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* fallthrough */ }
  return `scan-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function QrScanner({
  workId, oaId, locationId, pageId, mode,
  verifiedLineUserId, isLineUserVerified, scanQrEnabled, isInClient,
}: QrScannerProps) {
  const [state, setState] = useState<QrState>("idle");
  const [value, setValue] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 計測（fire-and-forget）。lineUserId は verified のみ採用。送信結果はサーバーが記録するため
  // ここではスキャンのライフサイクルのみを記録する。
  const emitScan = useCallback((eventType: "qr_scan_success" | "qr_scan_failed" | "qr_scan_cancelled", extra?: Record<string, unknown>) => {
    recordLiffEvent({
      workId,
      pageId: pageId ?? undefined,
      lineUserId: isLineUserVerified ? verifiedLineUserId : null,
      eventType,
      metadata: { oaId: oaId ?? null, workId, locationId: locationId ?? null, mode: mode ?? null, isLineUserVerified, ...extra },
    });
  }, [workId, oaId, pageId, locationId, mode, isLineUserVerified, verifiedLineUserId]);

  const handleScan = useCallback(async () => {
    if (state === "scanning" || state === "sending") return; // 連打防止
    setNotice(null);
    setState("scanning");
    try {
      const liff = (await import("@line/liff")).default;
      const available =
        typeof liff.isApiAvailable === "function" &&
        liff.isApiAvailable("scanCodeV2") &&
        typeof liff.scanCodeV2 === "function";
      if (!available) {
        setState("failed");
        setNotice("この環境では QR 読み取りを利用できません。LINE アプリが最新かご確認ください。");
        emitScan("qr_scan_failed", { errorCode: "scan_unavailable" });
        return;
      }

      const result = await liff.scanCodeV2();
      const rawVal = result?.value ?? null;
      if (!rawVal) {
        // 値なし = キャンセル相当。API は呼ばない。
        setState("cancelled");
        emitScan("qr_scan_cancelled");
        return;
      }

      // UI 表示用は truncate。サーバーには生値を渡す（解決はサーバーが行う）。
      setValue(truncateQrValue(rawVal));

      // 送信前提: oaId + workId + verified session + accessToken。欠ければ送信しない（白画面にしない）。
      if (!oaId || !workId || !isLineUserVerified) {
        setState("failed");
        setNotice("LINE連携が確立していません。LINEアプリで開き直してください。");
        emitScan("qr_scan_success", { canSend: false, reason: !isLineUserVerified ? "unverified" : "missing_context" });
        return;
      }
      const accessToken = typeof liff.getAccessToken === "function" ? liff.getAccessToken() : null;
      if (!accessToken) {
        setState("failed");
        setNotice("LINE連携が確立していません。LINEアプリで開き直してください。");
        emitScan("qr_scan_success", { canSend: false, reason: "no_access_token" });
        return;
      }

      // ── サーバーへ送信（検証・解決・push はサーバー側）──
      setState("sending");
      const res = await fetch("/api/liff/qr/complete", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          accessToken,
          oaId,
          workId,
          locationId: locationId ?? undefined,
          pageId:     pageId ?? undefined,
          qrValue:    rawVal,
          scanId:     genScanId(),
          mode:       mode ?? undefined,
        }),
      });
      let body: unknown = null;
      try { body = await res.json(); } catch { /* body 解析不能 → interpret で failed に倒れる */ }
      const r = interpretQrComplete(res.status, body);
      setNotice(r.message);
      setState(outcomeToState(r.outcome));
    } catch (err) {
      if (isScanCancelError(err)) {
        setState("cancelled");
        emitScan("qr_scan_cancelled");
      } else {
        console.error("[LIFF][qr] error", err);
        setState("failed");
        setNotice("通信エラーが発生しました。もう一度お試しください。");
        emitScan("qr_scan_failed", { errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
      }
    }
  }, [state, oaId, workId, locationId, pageId, mode, isLineUserVerified, emitScan]);

  const reset = useCallback(() => { setState("idle"); setValue(null); setNotice(null); }, []);

  // ── 出せない環境の案内（白画面にしない） ──
  const guidance = qrScanGuidance({ scanQrEnabled, isInClient, scanCodeV2Available: true });
  if (!guidance.canScan && guidance.notice) {
    return (
      <div style={{ marginTop: 16, borderTop: "1px solid var(--liff-border,#EAEAEA)", paddingTop: 16 }}>
        <LiffResultState variant="warning" icon="📷" title={guidance.notice.title} description={guidance.notice.message} />
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--liff-border,#EAEAEA)", paddingTop: 16 }}>
      {state === "idle" && (
        <LiffButton type="button" variant="primary" onClick={handleScan}>📷 QR コードを読み取る</LiffButton>
      )}

      {(state === "scanning" || state === "sending") && (
        <LiffLoadingState
          title={state === "scanning" ? "カメラを起動しています" : "送信しています"}
          description="このまま少しだけお待ちください。"
        />
      )}

      {state === "sent" && (
        <LiffResultState
          variant="success"
          title="メッセージを送信しました"
          description={notice ?? "LINEのトーク画面をご確認ください。"}
          primaryActionLabel="もう一度読み取る"
          onPrimaryAction={reset}
        >
          {value && <p style={{ fontSize: 11, color: "var(--liff-tertiary-text,#8C8C8C)", wordBreak: "break-all", margin: 0 }}>{value}</p>}
        </LiffResultState>
      )}

      {state === "already_processed" && (
        <LiffResultState
          variant="info" icon="📩"
          title="読み取り済みです"
          description={notice ?? "このQRはすでに読み取り済みです。"}
          primaryActionLabel="別のQRを読み取る"
          onPrimaryAction={reset}
        />
      )}

      {(state === "unmatched" || state === "message_not_configured") && (
        <LiffResultState
          variant="warning"
          icon={state === "unmatched" ? "🔍" : "✉️"}
          title={state === "unmatched" ? "このQRはこの作品では使えません" : "送信するメッセージが未設定です"}
          description={notice ?? undefined}
          primaryActionLabel="もう一度読み取る"
          onPrimaryAction={reset}
        />
      )}

      {state === "cancelled" && (
        <LiffResultState
          variant="info" icon="📷"
          title="読み取りをキャンセルしました"
          primaryActionLabel="もう一度読み取る"
          onPrimaryAction={reset}
        />
      )}

      {state === "failed" && (
        <LiffResultState
          variant="error" icon="🌊"
          title="QR を読み取れませんでした"
          description={notice ?? "もう一度お試しください。読み取りができない場合は、LINE アプリ内で開いているかご確認ください。"}
          primaryActionLabel="もう一度試す"
          onPrimaryAction={reset}
        />
      )}
    </div>
  );
}

/** interpret の outcome を UI 状態へ。 */
function outcomeToState(outcome: QrSendOutcome): QrState {
  return outcome; // QrSendOutcome は QrState の部分集合
}
