// src/lib/external-links.ts
//
// 外部連携 API が返す「Whale Studio 管理画面 / Live(Staff) 画面へのリンク」を組み立てる純関数群。
//
// 返すのは URL 文字列のみ。これらの URL を開いた人は従来どおり Supabase Auth + RBAC で
// 保護される（= リンクを返すこと自体は所有関係・権限を一切バイパスしない）。
//
// URL は実在するルートのみを生成する（実コードで確認済み）:
//   - フェーズ編集(管理):  /oas/{oaId}/works/{workId}/phases/{phaseId}   … フェーズ単位
//   - シナリオフロー(管理): /oas/{oaId}/works/{workId}/scenario          … 作品単位
//   - Live 管理(Staff):     /oas/{oaId}/live/admin?workId={workId}        … 作品単位
//   - Live アクター(Staff): /oas/{oaId}/live/actor?workId={workId}        … 作品単位
//
// ※ Live/Staff 画面は OA×セッション×参加者スコープであり、フェーズ単位の URL は存在しない。
//    そのためフェーズ別 Staff リンクは生成しない（存在しない URL を捏造しない）。

/** 空文字・空白のみを null 扱いに正規化する。 */
function normalize(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * リンクのベース origin を解決する。
 * 既存慣習（src/lib/liff/config.ts 等）と同じ優先順:
 *   NEXT_PUBLIC_APP_URL → NEXT_PUBLIC_BASE_URL → 既定 https://app.whale-studio.app
 * 末尾スラッシュは除去する。
 */
export function getExternalBaseUrl(): string {
  const origin =
    normalize(process.env.NEXT_PUBLIC_APP_URL) ??
    normalize(process.env.NEXT_PUBLIC_BASE_URL) ??
    "https://app.whale-studio.app";
  return origin.replace(/\/$/, "");
}

/** 管理画面・フェーズ編集 URL（フェーズ単位）。 */
export function buildPhaseAdminUrl(oaId: string, workId: string, phaseId: string): string {
  return `${getExternalBaseUrl()}/oas/${oaId}/works/${workId}/phases/${phaseId}`;
}

/** 管理画面・シナリオフロー URL（作品単位）。 */
export function buildScenarioUrl(oaId: string, workId: string): string {
  return `${getExternalBaseUrl()}/oas/${oaId}/works/${workId}/scenario`;
}

/** Live 管理(Staff) 画面 URL（作品単位・?workId= で作品を絞り込む）。 */
export function buildLiveAdminUrl(oaId: string, workId: string): string {
  return `${getExternalBaseUrl()}/oas/${oaId}/live/admin?workId=${encodeURIComponent(workId)}`;
}

/** Live アクター(Staff) 画面 URL（作品単位・?workId= で作品を絞り込む）。 */
export function buildLiveActorUrl(oaId: string, workId: string): string {
  return `${getExternalBaseUrl()}/oas/${oaId}/live/actor?workId=${encodeURIComponent(workId)}`;
}
