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
      <div style={cardNoticeStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>{guidance.notice.title}</div>
        <p style={{ fontSize: 12, color: "#78716c", lineHeight: 1.6, marginTop: 4 }}>{guidance.notice.message}</p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid #e5e7eb", paddingTop: 16 }}>
      {state === "idle" && (
        <button type="button" onClick={handleScan} style={scanBtnStyle}>📷 QR コードを読み取る</button>
      )}

      {(state === "scanning" || state === "sending") && (
        <div style={{ textAlign: "center", padding: "12px 0" }}>
          <div style={spinnerStyle} />
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
            {state === "scanning" ? "カメラを起動しています..." : "送信しています..."}
          </p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {state === "sent" && (
        <div style={successCardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", marginBottom: 4 }}>メッセージを送信しました</div>
          <p style={{ fontSize: 12, color: "#435068", lineHeight: 1.6 }}>{notice ?? "LINEのトーク画面をご確認ください。"}</p>
          {value && <p style={{ fontSize: 11, color: "#9ca3af", wordBreak: "break-all", marginTop: 8 }}>{value}</p>}
          <button type="button" onClick={reset} style={{ ...retryBtnStyle, marginTop: 10 }}>もう一度読み取る</button>
        </div>
      )}

      {state === "already_processed" && (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <div style={infoCardStyle}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#2563eb" }}>読み取り済みです</div>
            <p style={{ fontSize: 12, color: "#78716c", lineHeight: 1.6, marginTop: 4 }}>{notice ?? "このQRはすでに読み取り済みです。"}</p>
          </div>
          <button type="button" onClick={reset} style={{ ...retryBtnStyle, marginTop: 10 }}>別のQRを読み取る</button>
        </div>
      )}

      {(state === "unmatched" || state === "message_not_configured") && (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <div style={cardNoticeStyle}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
              {state === "unmatched" ? "このQRは使えません" : "メッセージ未設定"}
            </div>
            <p style={{ fontSize: 12, color: "#78716c", lineHeight: 1.6, marginTop: 4 }}>{notice}</p>
          </div>
          <button type="button" onClick={reset} style={{ ...retryBtnStyle, marginTop: 10 }}>もう一度読み取る</button>
        </div>
      )}

      {state === "cancelled" && (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 10 }}>読み取りをキャンセルしました。</p>
          <button type="button" onClick={reset} style={retryBtnStyle}>もう一度読み取る</button>
        </div>
      )}

      {state === "failed" && (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <div style={cardNoticeStyle}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626" }}>QR を処理できませんでした</div>
            <p style={{ fontSize: 12, color: "#78716c", lineHeight: 1.6, marginTop: 4 }}>
              {notice ?? "もう一度お試しください。読み取りができない場合は、LINE アプリ内で開いているかご確認ください。"}
            </p>
          </div>
          <button type="button" onClick={reset} style={{ ...retryBtnStyle, marginTop: 10 }}>もう一度試す</button>
        </div>
      )}
    </div>
  );
}

/** interpret の outcome を UI 状態へ。 */
function outcomeToState(outcome: QrSendOutcome): QrState {
  return outcome; // QrSendOutcome は QrState の部分集合
}

const scanBtnStyle: React.CSSProperties = {
  width: "100%", padding: "14px 0",
  background: "#f3f4f6", color: "#374151",
  border: "1px solid #e5e7eb", borderRadius: 10,
  fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const retryBtnStyle: React.CSSProperties = {
  width: "100%", padding: "12px 0",
  background: "#f3f4f6", color: "#374151",
  border: "1px solid #e5e7eb", borderRadius: 10,
  fontSize: 13, fontWeight: 500, cursor: "pointer",
};
const cardNoticeStyle: React.CSSProperties = {
  background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10,
  padding: "12px 14px", marginTop: 16,
};
const successCardStyle: React.CSSProperties = {
  background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "14px 16px",
};
const infoCardStyle: React.CSSProperties = {
  background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "12px 14px", marginTop: 16,
};
const spinnerStyle: React.CSSProperties = {
  width: 28, height: 28,
  border: "3px solid #e5e7eb", borderTopColor: "#2563eb",
  borderRadius: "50%", animation: "spin 1s linear infinite",
  margin: "0 auto",
};
