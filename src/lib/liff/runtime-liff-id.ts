// src/lib/liff/runtime-liff-id.ts
//
// LIFF Runtime（/liff 配下のプレイヤー向けページ）が liff.init() に渡す LIFF ID の
// **クライアント側の解釈**を担う純関数。DOM / LIFF SDK / Prisma 非依存でテストできる。
//
// 背景（本番障害）:
//   作品ホーム（/liff/w/[workPublicId]）と個別ページ（/liff/w/.../p/[pagePublicId]）が
//   OA に関係なく process.env.NEXT_PUBLIC_LIFF_ID（全 OA 共通）で liff.init() していた。
//   LINE のユーザー ID は **プロバイダー単位**でスコープされるため、対象 OA の Messaging
//   チャネルと別プロバイダーのログインチャネルで init すると、取得できる lineUserId が
//   その OA では解決できず、GET /v2/bot/profile/{userId} が 404 → 「友だち追加してください」
//   になる（実際にはユーザーは友だち追加済み）。
//   → 対象 Work に紐づく Oa.liffId で init する必要がある。
//
// 解決順（サーバー側 /api/liff/config の getLiffIdForOa と同じ優先順位を**そのまま尊重**する）:
//   1. 対象 Work に紐づく Oa.liffId            → source="oa"
//   2. Oa.liffId が NULL のときのみ env        → source="env"（レガシー互換）
//   3. どちらも無い                            → source="none" → 設定エラー
//
// このモジュールは優先順位を**再実装しない**。サーバーが返した liffIdSource を信頼し、
// 「初期化してよいか / 設定エラーにするか」だけを判定する。
// クライアント側で env を読んで上書きすることは行わない（古いビルドの焼き込み値で
// 誤った LIFF ID を使わないため）。

/** /api/liff/config が返す liffId の解決元。 */
export type LiffIdSource = "oa" | "env" | "none";

/** /api/liff/config のレスポンスのうち、初期化判定に必要な最小形。 */
export interface RuntimeLiffConfigInput {
  liffId?: string | null;
  liffIdSource?: LiffIdSource | string | null;
}

export type RuntimeLiffIdResolution =
  /** liff.init({ liffId }) を実行してよい。 */
  | { kind: "ready"; liffId: string; source: "oa" | "env"; isLegacyEnvFallback: boolean }
  /** LIFF ID を決められない。init せず設定エラーを表示する。 */
  | { kind: "not_configured"; reason: "missing" | "unknown_source" };

/**
 * サーバーが解決した設定から「この端末で liff.init() してよいか」を判定する。
 *
 * - source="oa"  → 対象 OA 固有の LIFF ID。通常経路。
 * - source="env" → **レガシーフォールバック**。Oa.liffId が未設定の既存 Work のみ。
 *                  初期化は許可するが、呼び出し側が運用者向けに可視化できるよう
 *                  isLegacyEnvFallback=true を返す。
 * - それ以外 / liffId 空 → 設定エラー（誤った ID で init しない）。
 */
export function resolveRuntimeLiffId(cfg: RuntimeLiffConfigInput | null | undefined): RuntimeLiffIdResolution {
  const liffId = (cfg?.liffId ?? "").trim();
  const source = cfg?.liffIdSource ?? null;

  if (liffId.length === 0) return { kind: "not_configured", reason: "missing" };
  if (source !== "oa" && source !== "env") return { kind: "not_configured", reason: "unknown_source" };

  return { kind: "ready", liffId, source, isLegacyEnvFallback: source === "env" };
}

/** 設定エラー時にプレイヤーへ出す文言（内部情報・LIFF ID は含めない）。 */
export const RUNTIME_LIFF_NOT_CONFIGURED_MESSAGE =
  "この作品は現在ご利用いただけません。運営までお問い合わせください。";

/**
 * useLiffSDK へ渡す引数へ変換する。
 *   - 未解決（config 取得前）    → null（**liff.init() を実行しない**）
 *   - 解決できた                → その LIFF ID
 *   - 設定エラー                → null（init せず、呼び出し側がエラー画面を出す）
 *
 * **undefined は返さない**。undefined は useLiffSDK では
 * 「env フォールバック許可（レガシー経路専用）」を意味するため、
 * OA 固有ページから誤って env で初期化されるのを型と実装の両方で防ぐ。
 */
export function toUseLiffSdkArg(
  resolution: RuntimeLiffIdResolution | null,
): string | null {
  if (!resolution) return null;
  return resolution.kind === "ready" ? resolution.liffId : null;
}
