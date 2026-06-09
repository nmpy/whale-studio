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
