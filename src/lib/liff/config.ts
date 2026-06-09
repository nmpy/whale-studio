// src/lib/liff/config.ts
//
// LIFF (LINE Front-end Framework) 設定の解決ヘルパー。
// OA 単位の liffId を最優先し、未設定なら開発/フォールバック用の env にフォールバックする。
//
// 解決順（getLiffIdForOa）:
//   1. Oa.liffId（管理画面で設定）
//   2. process.env.NEXT_PUBLIC_LIFF_ID（開発用 / フォールバック）
//   3. どちらも無ければ null → 管理画面 / Runtime で「未設定」を明示表示する
//
// すべて純関数。サーバ / クライアント双方から呼べる（DB アクセスはしない）。

/** getLiffIdForOa が受け取る最小の OA 形（Prisma の Oa でも、API の部分形でも可）。 */
export interface OaLiffConfigInput {
  liffId?:            string | null;
  liffEndpointUrl?:   string | null;
  liffScanQrEnabled?: boolean | null;
}

/** 空文字や空白のみを null 扱いに正規化する。 */
function normalize(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * この OA に対して使うべき LIFF ID を解決する。
 * Oa.liffId（設定済み）→ NEXT_PUBLIC_LIFF_ID（フォールバック）→ null。
 */
export function getLiffIdForOa(oa: OaLiffConfigInput | null | undefined): string | null {
  const fromOa = normalize(oa?.liffId);
  if (fromOa) return fromOa;
  const fromEnv = normalize(process.env.NEXT_PUBLIC_LIFF_ID);
  return fromEnv;
}

/** LIFF ID の解決元（UI で「OA設定 / 環境変数フォールバック / 未設定」を出し分けるため）。 */
export type LiffIdSource = "oa" | "env" | "none";

export function getLiffIdSource(oa: OaLiffConfigInput | null | undefined): LiffIdSource {
  if (normalize(oa?.liffId)) return "oa";
  if (normalize(process.env.NEXT_PUBLIC_LIFF_ID)) return "env";
  return "none";
}

/** OA が LIFF を使える状態か（liffId が解決できるか）。 */
export function isLiffConfigured(oa: OaLiffConfigInput | null | undefined): boolean {
  return getLiffIdForOa(oa) !== null;
}

/** LINE Developers Console の Endpoint URL に付与される LIFF Runtime の入口 path。
 *  Endpoint URL = `${APP_ORIGIN}/liff` を想定しているため、sub-path には `/liff` を含めない。 */
export function getLiffEndpointPath(): string {
  return "/liff";
}

/**
 * 実機 LIFF URL を組み立てる: `https://liff.line.me/{liffId}{path}?{query}`。
 * - path は LIFF Runtime の sub-path（例: `/w/abc`）。先頭スラッシュは任意（正規化する）。
 * - query は付与する検索パラメータ（任意）。
 * - liffId が空なら null を返す（呼び出し側で「未設定」を表示する）。
 */
export function buildLiffUrl(args: {
  liffId: string | null | undefined;
  path?:  string;
  query?: Record<string, string | number | boolean | null | undefined>;
}): string | null {
  const id = normalize(args.liffId);
  if (!id) return null;

  let path = args.path ?? "";
  if (path && !path.startsWith("/")) path = `/${path}`;

  const qs = new URLSearchParams();
  if (args.query) {
    for (const [k, v] of Object.entries(args.query)) {
      if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
    }
  }
  const q = qs.toString();
  return `https://liff.line.me/${id}${path}${q ? `?${q}` : ""}`;
}

/**
 * LINE Developers の Endpoint URL に設定すべき推奨値。
 * NEXT_PUBLIC_APP_URL → NEXT_PUBLIC_BASE_URL → 既定 `https://app.whale-studio.app` の優先順。
 * 末尾に getLiffEndpointPath()（= /liff）を付ける。
 */
export function getRecommendedEndpointUrl(originOverride?: string | null): string {
  const origin =
    normalize(originOverride) ??
    normalize(process.env.NEXT_PUBLIC_APP_URL) ??
    normalize(process.env.NEXT_PUBLIC_BASE_URL) ??
    "https://app.whale-studio.app";
  return `${origin.replace(/\/$/, "")}${getLiffEndpointPath()}`;
}

/**
 * ロケーションチェックイン用の LIFF URL を `liff.state` 形式で組み立てる。
 *
 * `https://liff.line.me/{liffId}?liff.state=%2Fliff%3Fwork_id%3D...%26location_id%3D...`
 *
 * なぜ liff.state 形式か:
 *   - LINE は LIFF URL の `liff.state` 値を endpoint 側へそのまま引き渡す。これにより
 *     LINE Developers Console の Endpoint URL のパス設定（/liff の有無等）に依存せず、
 *     `/liff?work_id=...&location_id=...` を確実に復元できる。
 *   - 旧来の `?work_id=...&location_id=...`（liffId 直下クエリ）形式は、endpoint のパスや
 *     primary redirect の挙動差で work_id/location_id が落ちるケースがあった。
 *
 * work_id / location_id は UUID（または publicId）をそのまま渡す。URLSearchParams が
 * liff.state 値全体を 1 回だけ URL エンコードする（二重エンコードしない）。
 */
export function buildLiffCheckinUrl(args: {
  liffId:     string | null | undefined;
  workId:     string;
  locationId: string;
}): string | null {
  if (!args.workId || !args.locationId) return null;
  const liffState = `${getLiffEndpointPath()}?work_id=${args.workId}&location_id=${args.locationId}`;
  return buildLiffUrl({ liffId: args.liffId, query: { "liff.state": liffState } });
}
