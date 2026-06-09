"use client";

// src/app/liff/_components/QrScanner.tsx
//
// LIFF Runtime 内の QR 読み取り導線（slice 4）。
//
// ■ できること（本スライス）
//   - liff.scanCodeV2 が使える環境でのみ「QR を読み取る」ボタンを表示
//   - LIFF 外ブラウザ / scanCodeV2 非対応 / Scan QR 未有効 では、白画面にせず案内を表示
//   - 読み取り成功/失敗/キャンセルを状態として分けて表示（連打防止の scanning 状態あり）
//   - 計測イベント（qr_scan_success / qr_scan_failed / qr_scan_cancelled）を送信
//
// ■ まだやらないこと（follow-up）
//   - 読み取り結果（locationPublicId / code / pageId 等）に応じた checkin API / transition API 接続
//   - QR 成功後の OA 自動メッセージ送信
//   - QR 成功後のシナリオ遷移
//   → 現状は「表示まで」。読み取り値を即座に認可・遷移には使わない。
//
// ■ 本人確定の扱い
//   verifiedLineUserId（サーバー検証済み）のみを verified として扱う。未検証時は
//   イベントの lineUserId を null にし、metadata.isLineUserVerified=false を残す。

import { useCallback, useState } from "react";
import { recordLiffEvent } from "@/lib/liff-events";
import { qrScanGuidance, truncateQrValue, isScanCancelError } from "@/lib/liff/qr";

type QrState = "idle" | "scanning" | "success" | "failed" | "cancelled";

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

export function QrScanner({
  workId, oaId, locationId, pageId, mode,
  verifiedLineUserId, isLineUserVerified, scanQrEnabled, isInClient,
}: QrScannerProps) {
  const [state, setState] = useState<QrState>("idle");
  const [value, setValue] = useState<string | null>(null);

  // 計測イベント送信（fire-and-forget）。lineUserId は verified のみ採用。
  const emit = useCallback((eventType: Parameters<typeof recordLiffEvent>[0]["eventType"], extra?: Record<string, unknown>) => {
    recordLiffEvent({
      workId,
      pageId: pageId ?? undefined,
      lineUserId: isLineUserVerified ? verifiedLineUserId : null,
      eventType,
      metadata: {
        oaId: oaId ?? null,
        workId,
        pageId: pageId ?? null,
        locationId: locationId ?? null,
        mode: mode ?? null,
        isLineUserVerified,
        ...extra,
      },
    });
  }, [workId, oaId, pageId, locationId, mode, isLineUserVerified, verifiedLineUserId]);

  const handleScan = useCallback(async () => {
    if (state === "scanning") return; // 連打防止
    setState("scanning");
    try {
      const liff = (await import("@line/liff")).default;
      const available =
        typeof liff.isApiAvailable === "function" &&
        liff.isApiAvailable("scanCodeV2") &&
        typeof liff.scanCodeV2 === "function";
      if (!available) {
        setState("failed");
        emit("qr_scan_failed", { errorCode: "scan_unavailable" });
        return;
      }
      const result = await liff.scanCodeV2();
      const raw = result?.value ?? null;
      if (!raw) {
        // 値なし = キャンセル相当
        setState("cancelled");
        emit("qr_scan_cancelled");
        return;
      }
      const safe = truncateQrValue(raw);
      setValue(safe);
      setState("success");
      emit("qr_scan_success", { qrValuePreview: safe });
      // TODO(follow-up): 読み取り結果に応じて次へ接続する。
      //   - locationPublicId / code → POST /api/liff/checkin（QR チェックイン）
      //   - pageId → 該当 LIFF ページへ遷移
      //   - transition トリガー → transition API でシナリオ遷移
      //   - QR 成功後の OA 自動メッセージ送信
      //  本スライスでは表示までに留め、認可・遷移には使わない。
    } catch (err) {
      if (isScanCancelError(err)) {
        setState("cancelled");
        emit("qr_scan_cancelled");
      } else {
        // ユーザー向け表示と詳細ログを分離（詳細は console、画面は汎用文言）。
        console.error("[LIFF][qr] scanCodeV2 error", err);
        setState("failed");
        emit("qr_scan_failed", { errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
      }
    }
  }, [state, emit]);

  const reset = useCallback(() => { setState("idle"); setValue(null); }, []);

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
        <button type="button" onClick={handleScan} style={scanBtnStyle}>
          📷 QR コードを読み取る
        </button>
      )}

      {state === "scanning" && (
        <div style={{ textAlign: "center", padding: "12px 0" }}>
          <div style={spinnerStyle} />
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>カメラを起動しています...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {state === "success" && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", marginBottom: 4 }}>QR を読み取りました</div>
          <p style={{ fontSize: 12, color: "#435068", wordBreak: "break-all", lineHeight: 1.6 }}>{value}</p>
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
            <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626" }}>QR を読み取れませんでした</div>
            <p style={{ fontSize: 12, color: "#78716c", lineHeight: 1.6, marginTop: 4 }}>
              もう一度お試しください。読み取りができない場合は、LINE アプリ内で開いているか、Scan QR 設定が有効かをご確認ください。
            </p>
          </div>
          <button type="button" onClick={reset} style={{ ...retryBtnStyle, marginTop: 10 }}>もう一度試す</button>
        </div>
      )}
    </div>
  );
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
const spinnerStyle: React.CSSProperties = {
  width: 28, height: 28,
  border: "3px solid #e5e7eb", borderTopColor: "#2563eb",
  borderRadius: "50%", animation: "spin 1s linear infinite",
  margin: "0 auto",
};
