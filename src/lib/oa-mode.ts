// src/lib/oa-mode.ts
//
// OA の「運用モード」（Oa.mode）の定数・型・表示ラベル（client/server 共通の純ロジック）。
//   - messaging = 配信（お知らせ/予約/テスト配信）
//   - content   = LINE上で進行する謎解き/マダミス/体験型（既定・従来の studio 用途）
//   - live      = 現地公演運営（Operation Belkish 等。for Admin/Staff/Player 導線を前面化）
//
// 加算的サーフェス方針: mode は「トップの導線/ランディングの出し分け」にのみ使う。
// 既存機能を mode で隠さない。Live 実体アクセスは従来どおり OaEntitlement/canAccessLive で保護する。

export const OA_MODES = ["messaging", "content", "live"] as const;
export type OaMode = (typeof OA_MODES)[number];

/** 既定モード。既存 OA・不正値はこれにフォールバックし挙動を変えない。 */
export const DEFAULT_OA_MODE: OaMode = "content";

export const OA_MODE_LABELS: Record<OaMode, string> = {
  messaging: "Messaging（配信）",
  content:   "Content（謎解き・体験）",
  live:      "Live（現地公演運営）",
};

export const OA_MODE_DESCRIPTIONS: Record<OaMode, string> = {
  messaging: "お知らせ配信・予約配信・テスト配信などのメッセージ運用。",
  content:   "LINE上で進行する謎解き・マダミス・体験型コンテンツ。",
  live:      "現地公演の運営（部屋管理・スタッフ監視・演出トリガー・問い合わせ対応）。",
};

/** 任意値を OaMode に正規化する。不正/未設定は DEFAULT_OA_MODE。 */
export function normalizeOaMode(v: string | null | undefined): OaMode {
  return (OA_MODES as readonly string[]).includes(v ?? "") ? (v as OaMode) : DEFAULT_OA_MODE;
}

export function isOaMode(v: unknown): v is OaMode {
  return typeof v === "string" && (OA_MODES as readonly string[]).includes(v);
}
