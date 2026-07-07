// src/lib/call-request.ts
//
// 「通話リクエスト」メッセージ種別（message_type="call_request"）の純ロジック。
//   - 保存形式: message_type="call_request" とし、設定 JSON は flex_payload_json に格納する
//     （DB migration 不要）。alt_text は Flex の altText に使う。
//   - 送信時: この設定から LINE Flex Message（bubble: header=タイトル / body=本文・補足 / footer=ボタン）
//     を生成して送る。LINE の「本物の通話リクエスト」専用 API は使わない（uri action のボタン付き Flex）。
//   - webhook / runtime に特殊な通話 API 呼び出しは追加しない。タップしても webhook は返らない前提。
//
// 純関数のみ（DB / LINE API 非依存）。単体テスト可能。

/** 通話先タイプ。 */
export type CallTargetType = "line_call_url" | "tel" | "url";

/** 通話リクエスト設定（flex_payload_json に JSON 文字列として保存）。 */
export interface CallRequestConfig {
  title:        string;
  body:         string;
  buttonLabel:  string;
  callType:     CallTargetType;
  /** callType="line_call_url" のとき使用。 */
  lineCallUrl?: string | null;
  /** callType="tel" のとき使用（表示用の生入力。URI 化時に正規化）。 */
  tel?:         string | null;
  /** callType="url" のとき使用。 */
  url?:         string | null;
  /** 補足テキスト（任意）。 */
  supplement?:  string | null;
}

// LINE の制限に沿った上限（安全側）。
export const CALL_REQUEST_ALT_TEXT_MAX = 400;   // Flex Message altText 上限
export const CALL_REQUEST_LABEL_MAX    = 40;    // uri action の label 上限
export const CALL_REQUEST_TITLE_MAX    = 100;
export const CALL_REQUEST_BODY_MAX     = 1000;
export const CALL_REQUEST_SUPPLEMENT_MAX = 500;

/** 既定値（新規作成時のフォーム初期値）。 */
export const CALL_REQUEST_DEFAULTS: CallRequestConfig = {
  title:       "通話リクエスト",
  body:        "必要に応じて、下のボタンから通話を開始してください。",
  buttonLabel: "電話をかける",
  callType:    "line_call_url",
  lineCallUrl: "",
  tel:         "",
  url:         "",
  supplement:  "",
};

/** 電話番号を URI 用に正規化: 数字と先頭 + のみ残す（ハイフン/スペース/括弧は除去）。 */
export function normalizeCallTel(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  const plus = t.startsWith("+") ? "+" : "";
  const digits = t.replace(/[^\d]/g, "");
  return digits ? plus + digits : "";
}

/** ボタンの uri を生成。生成できない（必須未入力）なら null。 */
export function buildCallRequestUri(cfg: CallRequestConfig): string | null {
  if (cfg.callType === "tel") {
    const norm = normalizeCallTel(cfg.tel);
    if (norm.replace(/^\+/, "").length < 1) return null;
    return `tel:${norm}`;
  }
  const url = (cfg.callType === "line_call_url" ? cfg.lineCallUrl : cfg.url)?.trim();
  if (!url) return null;
  return url;
}

/** altText を生成（明示 alt → タイトル → 既定。上限でトリム）。 */
export function buildCallRequestAltText(cfg: CallRequestConfig, explicitAlt?: string | null): string {
  const base = (explicitAlt?.trim() || cfg.title?.trim() || "通話リクエスト");
  return base.slice(0, CALL_REQUEST_ALT_TEXT_MAX);
}

/**
 * 保存可否バリデーション。問題があれば日本語メッセージ、無ければ null。
 *   - title / body / buttonLabel 必須。buttonLabel は LINE label 上限。
 *   - callType ごとの必須（tel は正規化後1桁以上、url/line_call_url は非空）。
 */
export function validateCallRequestConfig(cfg: Partial<CallRequestConfig> | null | undefined): string | null {
  if (!cfg) return "通話リクエストの設定が未入力です";
  if (!cfg.title?.trim())       return "タイトルを入力してください";
  if (!cfg.body?.trim())        return "本文を入力してください";
  if (!cfg.buttonLabel?.trim()) return "ボタンラベルを入力してください";
  if (cfg.buttonLabel.trim().length > CALL_REQUEST_LABEL_MAX) {
    return `ボタンラベルは${CALL_REQUEST_LABEL_MAX}文字以内で入力してください`;
  }
  const ct: CallTargetType = cfg.callType ?? "line_call_url";
  if (ct === "tel") {
    if (normalizeCallTel(cfg.tel).replace(/^\+/, "").length < 1) return "電話番号を入力してください";
  } else {
    const url = (ct === "line_call_url" ? cfg.lineCallUrl : cfg.url)?.trim();
    if (!url) return ct === "line_call_url" ? "LINEコールURLを入力してください" : "URLを入力してください";
  }
  return null;
}

/**
 * flex_payload_json（保存済みの通話リクエスト設定）の状態を分類する。
 *   - "empty"         : 未設定（null/空文字）
 *   - "invalid_json"  : JSON として壊れている
 *   - "invalid_config": JSON だが必須項目/通話先が不足（validateCallRequestConfig で NG）
 *   - "ok"            : 送信可能（Flex を生成できる）
 * CMS 警告表示（保存済みデータの健全性）と送信時 drop の理由分類の両方から使う純関数。
 */
export type CallRequestConfigStatus = "ok" | "empty" | "invalid_json" | "invalid_config";

export function classifyCallRequestConfig(
  configJson: string | null | undefined,
): CallRequestConfigStatus {
  if (!configJson || !configJson.trim()) return "empty";
  let cfg: unknown;
  try {
    cfg = JSON.parse(configJson);
  } catch {
    return "invalid_json";
  }
  return validateCallRequestConfig(cfg as Partial<CallRequestConfig>) ? "invalid_config" : "ok";
}

/** LINE Flex（bubble）を生成する。設定 JSON（flex_payload_json）と alt_text から。無効なら null。 */
export function buildCallRequestFlex(
  configJson: string | null | undefined,
  explicitAlt?: string | null,
): { altText: string; contents: Record<string, unknown> } | null {
  if (!configJson) return null;
  let cfg: CallRequestConfig;
  try {
    cfg = JSON.parse(configJson) as CallRequestConfig;
  } catch {
    return null;
  }
  const uri = buildCallRequestUri(cfg);
  if (!uri) return null;

  const label   = (cfg.buttonLabel?.trim() || "電話をかける").slice(0, CALL_REQUEST_LABEL_MAX);
  const altText = buildCallRequestAltText(cfg, explicitAlt);

  const bodyContents: Record<string, unknown>[] = [
    { type: "text", text: cfg.body?.trim() || "", wrap: true, size: "sm", color: "#333333" },
  ];
  if (cfg.supplement?.trim()) {
    bodyContents.push({ type: "text", text: cfg.supplement.trim(), wrap: true, size: "xs", color: "#999999", margin: "md" });
  }

  const contents: Record<string, unknown> = {
    type: "bubble",
    header: {
      type: "box", layout: "vertical",
      contents: [
        { type: "text", text: cfg.title?.trim() || "通話リクエスト", weight: "bold", size: "md", color: "#111111", wrap: true },
      ],
    },
    body: { type: "box", layout: "vertical", spacing: "sm", contents: bodyContents },
    footer: {
      type: "box", layout: "vertical",
      contents: [
        { type: "button", style: "primary", color: "#06C755", action: { type: "uri", label, uri } },
      ],
    },
  };
  return { altText, contents };
}
