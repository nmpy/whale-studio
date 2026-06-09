// src/lib/liff/qr.ts
//
// QR スキャナ導線の「使えるか / 案内文言」「読み取り値の安全な整形」を担う純関数群。
// UI コンポーネント（QrScanner）から切り出してテスト可能にする。

export interface QrScanGuidance {
  /** スキャンボタンを出してよいか。 */
  canScan: boolean;
  /** canScan=false のときに表示する案内（理由）。 */
  notice?: { title: string; message: string };
}

/**
 * QR スキャンの可否を判定する。
 *  - scanQrEnabled=false（OA 設定 Off）: 「QR 未有効」案内。
 *  - LIFF 外ブラウザ: 「LINE アプリで開いてください」案内。
 *  - scanCodeV2 非対応（LINE Developers の Scan QR Off / 古いアプリ等）: その旨案内。
 *  どれにも該当しなければ canScan=true。
 */
export function qrScanGuidance(args: {
  scanQrEnabled:        boolean;
  isInClient:           boolean;
  scanCodeV2Available:  boolean;
}): QrScanGuidance {
  if (!args.scanQrEnabled) {
    return { canScan: false, notice: { title: "QR読み取りは利用できません", message: "この作品では QR コード読み取りが有効になっていません。" } };
  }
  if (!args.isInClient) {
    return { canScan: false, notice: { title: "LINE アプリで開いてください", message: "QR コード読み取りは LINE アプリ内でのみご利用いただけます。実機確認用 URL を LINE アプリで開いてください。" } };
  }
  if (!args.scanCodeV2Available) {
    return { canScan: false, notice: { title: "この環境では QR 読み取りを利用できません", message: "LINE Developers Console の LIFF 設定で Scan QR が有効か、LINE アプリが最新かをご確認ください。" } };
  }
  return { canScan: true };
}

/**
 * 読み取った QR 値を保存・表示用に安全化する。
 *  - 前後空白を除去。空なら null。
 *  - 長すぎる値は max 文字で切り詰め（個人情報やトークンをそのまま長大に保存しない安全側）。
 */
export function truncateQrValue(value: string | null | undefined, max = 200): string | null {
  if (!value) return null;
  const t = value.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** scanCodeV2 の reject がユーザーキャンセル由来かを大まかに判定する。 */
export function isScanCancelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /cancel|abort|user.?cancel|closed/i.test(msg);
}

// ─────────────────────────────────────────────────────────────
// POST /api/liff/qr/complete のレスポンス解釈（純関数・テスト可能）
// ─────────────────────────────────────────────────────────────

/** QR 成功 API 呼び出し後の UI 終端状態。 */
export type QrSendOutcome =
  | "sent"                  // メッセージ送信成功
  | "already_processed"     // 二重送信抑止（既読み取り済み）
  | "unmatched"             // この作品では使えない QR
  | "message_not_configured"// QR は解決できたが送信メッセージ未設定
  | "failed";               // 認証/権限/送信失敗など

export interface QrCompleteInterpretation {
  outcome: QrSendOutcome;
  /** ユーザー向け表示文言（サーバーの message があれば優先）。 */
  message: string;
}

/**
 * `/api/liff/qr/complete` の HTTP ステータス + レスポンス body を UI 状態へ写像する。
 * - 業務結果（sent / alreadyProcessed / code）は 2xx の `data` に入る。
 * - 認証/権限/送信失敗は error エンベロープ（4xx/5xx）。
 * いずれも白画面にせず、ユーザー向けの安全な文言を返す。
 */
export function interpretQrComplete(
  httpStatus: number,
  body: unknown,
): QrCompleteInterpretation {
  const b = (body ?? {}) as {
    data?: { ok?: boolean; sent?: boolean; alreadyProcessed?: boolean; code?: string; message?: string };
    error?: { code?: string; message?: string };
  };

  if (httpStatus >= 200 && httpStatus < 300 && b.data) {
    const d = b.data;
    if (d.sent === true) {
      return { outcome: "sent", message: d.message || "メッセージを送信しました。LINEのトーク画面をご確認ください。" };
    }
    if (d.alreadyProcessed === true) {
      return { outcome: "already_processed", message: d.message || "このQRはすでに読み取り済みです。" };
    }
    if (d.code === "message_not_configured") {
      return { outcome: "message_not_configured", message: d.message || "QRは読み取りましたが、送信するメッセージが設定されていません。" };
    }
    if (d.code === "qr_not_matched" || d.ok === false) {
      return { outcome: "unmatched", message: d.message || "このQRコードはこの作品では使えません。" };
    }
    if (d.code === "service_suspended") {
      return { outcome: "failed", message: d.message || "現在このアカウントのサービスは利用できません。" };
    }
    return { outcome: "failed", message: "処理結果を確認できませんでした。もう一度お試しください。" };
  }

  // ── error エンベロープ（原因別に文言を出し分ける） ──
  const code = b.error?.code;
  if (code === "FEATURE_DISABLED") {
    return { outcome: "failed", message: "この作品ではQR読み取りが有効になっていません。" };
  }
  if (code === "PLAN_REQUIRED") {
    // runtime からは原則出ない想定（plan guard 撤去済み）が、出た場合に分かる文言にする。
    return { outcome: "failed", message: b.error?.message || "この機能を使うにはプラン変更が必要です。" };
  }
  if (code === "SEND_FAILED") {
    // push 失敗。最も多い原因は「公式アカウント未友だち」。次の行動が分かる文言にする。
    return { outcome: "failed", message: "メッセージ送信に失敗しました。公式アカウントを友だち追加しているかご確認のうえ、もう一度お試しください。" };
  }
  if (httpStatus === 401) {
    return { outcome: "failed", message: "LINE連携に失敗しました。もう一度開き直してください。" };
  }
  return { outcome: "failed", message: "メッセージ送信に失敗しました。もう一度お試しください。" };
}
