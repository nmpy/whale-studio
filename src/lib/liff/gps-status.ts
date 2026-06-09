// src/lib/liff/gps-status.ts
//
// GPS チェックインの「状態 → 表示（タイトル / 本文 / CTA / トーン）」を 1 箇所に集約した純関数群。
// _gps-checkin.tsx と /liff entry の qr_and_gps フローで共有し、文言・導線を一貫させる。
// UI コンポーネントから切り出すことで unit test 可能にする（既存の表示挙動は維持）。

export type GpsStatus =
  | "idle"
  | "acquiring"
  | "submitting"
  | "success"
  | "out_of_range"
  | "denied"      // 今回拒否（再許可で復帰しうる）
  | "blocked"     // 恒久ブロック（設定変更が必要）
  | "unavailable" // 位置取得不能（電波等）
  | "timeout"     // 取得タイムアウト
  | "error";      // その他

/** チェックイン試行ログ (POST /api/liff/checkin-attempt) に送る status 値。 */
export type GpsAttemptStatus = "permission_denied" | "gps_unavailable" | "timeout" | "unknown_error";

export type GpsTone = "neutral" | "info" | "warn" | "danger" | "success";

export interface GpsStatusPresentation {
  /** 見出し（未設定の状態では null）。 */
  title:   string | null;
  /** 本文。 */
  message: string;
  /** 表示トーン（色分けの指針。具体的な配色は呼び出し側）。 */
  tone:    GpsTone;
  /** 「もう一度試す」系の再試行 CTA を出すか。 */
  showRetry: boolean;
  /** 「QR でチェックイン」フォールバック案内を出すか。 */
  showQrFallback: boolean;
}

/**
 * GeolocationPositionError を内部 GpsStatus に分類する。
 * - PERMISSION_DENIED は「今回拒否(denied)」に分類（恒久 blocked は Permissions API 側で別途判定）。
 */
export function classifyGeolocationError(err: { code: number; PERMISSION_DENIED: number; POSITION_UNAVAILABLE: number; TIMEOUT: number }): GpsStatus {
  switch (err.code) {
    case err.PERMISSION_DENIED:    return "denied";
    case err.POSITION_UNAVAILABLE: return "unavailable";
    case err.TIMEOUT:              return "timeout";
    default:                       return "error";
  }
}

/** GpsStatus → 試行ログ用 status（不要な状態は null）。 */
export function attemptStatusFor(status: GpsStatus): GpsAttemptStatus | null {
  switch (status) {
    case "denied":
    case "blocked":      return "permission_denied";
    case "unavailable":  return "gps_unavailable";
    case "timeout":      return "timeout";
    case "error":        return "unknown_error";
    default:             return null; // success/out_of_range/idle 等はログ対象外
  }
}

export interface GpsPresentationContext {
  /** out_of_range 用: 対象地点名。 */
  locationName?: string | null;
  /** out_of_range 用: 現在距離（m）。 */
  distanceMeters?: number | null;
  /** out_of_range 用: チェックイン半径（m）。 */
  radiusMeters?: number | null;
  /** success 用: チェックイン完了メッセージ（API 由来）。 */
  successMessage?: string | null;
  /** success 用: 次フェーズ遷移があるか。 */
  hasTransition?: boolean;
  /** error/unavailable 用: API/詳細メッセージで上書きしたい場合。 */
  detailMessage?: string | null;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `約${Math.round(meters)}m`;
  return `約${(meters / 1000).toFixed(1)}km`;
}

/**
 * 状態 → 表示内容を返す。文言は既存 _gps-checkin.tsx のトーンを踏襲（やさしい言い回し）。
 */
export function gpsStatusPresentation(status: GpsStatus, ctx: GpsPresentationContext = {}): GpsStatusPresentation {
  switch (status) {
    case "idle":
      return {
        title: null,
        message: "現在地を使って、目的地に到着したかを確認します。位置情報はこのチェックイン判定のみに使用し、常時追跡は行いません。",
        tone: "neutral", showRetry: false, showQrFallback: false,
      };
    case "acquiring":
      return { title: null, message: "位置情報を取得中...", tone: "info", showRetry: false, showQrFallback: false };
    case "submitting":
      return { title: null, message: "チェックイン判定中...", tone: "info", showRetry: false, showQrFallback: false };
    case "success": {
      const extra = ctx.successMessage ? ` ${ctx.successMessage}` : "";
      const trans = ctx.hasTransition ? " 物語が進行します…" : "";
      return { title: "チェックイン完了！", message: `${extra}${trans}`.trim() || "チェックインが完了しました。", tone: "success", showRetry: false, showQrFallback: false };
    }
    case "out_of_range": {
      const parts: string[] = ["現在地は取得できましたが、まだチェックイン可能範囲の外です。もう少し目的地に近づいてから、もう一度お試しください。"];
      if (ctx.locationName) parts.push(`対象地点：${ctx.locationName}`);
      if (ctx.radiusMeters != null) parts.push(`チェックイン範囲：半径${ctx.radiusMeters}m 以内`);
      if (ctx.distanceMeters != null) parts.push(`現在の距離：${formatDistance(ctx.distanceMeters)}`);
      return { title: "もう少しで到着です", message: parts.join("\n"), tone: "warn", showRetry: true, showQrFallback: false };
    }
    case "denied":
      return {
        title: "位置情報の利用が許可されていません",
        message: "チェックインには位置情報の許可が必要です。もう一度お試しいただき、表示される確認で「許可」を選んでください。",
        tone: "danger", showRetry: true, showQrFallback: true,
      };
    case "blocked":
      return {
        title: "位置情報がブロックされています",
        message: "以前に拒否したため、ブラウザ/LINE アプリが位置情報を自動ブロックしています。アプリまたは端末の設定から「位置情報」の許可を有効にし、この画面に戻って再試行してください。",
        tone: "danger", showRetry: true, showQrFallback: true,
      };
    case "unavailable":
      return {
        title: "現在地を取得できませんでした",
        message: ctx.detailMessage || "電波状況のよい場所に移動してから、もう一度お試しください。",
        tone: "warn", showRetry: true, showQrFallback: true,
      };
    case "timeout":
      return {
        title: "位置情報の取得に時間がかかっています",
        message: "通信が不安定かもしれません。少し時間をおいて、もう一度お試しください。",
        tone: "warn", showRetry: true, showQrFallback: true,
      };
    case "error":
    default:
      return {
        title: "エラーが発生しました",
        message: ctx.detailMessage || "チェックインに失敗しました。もう一度お試しください。",
        tone: "danger", showRetry: true, showQrFallback: false,
      };
  }
}
