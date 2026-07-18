// src/lib/external-auth.ts
//
// 外部連携 API (`/api/external/v1/*`) 専用の APIキー認証ガード。
//
// 既存の Supabase Auth (`withAuth`) / RBAC (`requireRole`) とは完全に独立した別系統。
// 外部システムは Supabase セッションを持たないため、共有 APIキーで守る。
// このガードは **読み取り専用 API** 用であり、OA/Work の所有関係や既存認証には一切干渉しない。
//
// セキュリティ方針:
//   - ヘッダー `x-whale-api-key` を必須とし、env `WHALE_EXTERNAL_API_KEY` と定数時間比較する。
//   - `WHALE_EXTERNAL_API_KEY` が未設定なら **fail closed** で 503（設定不備）。全環境共通。
//   - 対象 OA は env `WHALE_EXTERNAL_OA_IDS`（カンマ区切り allowlist）でホワイトリスト化する。
//     未設定なら allowlist は **空集合**（= deny all）。「全 active 作品を返す」挙動には絶対にしない
//     （= production でも fail closed）。
//
// 将来拡張: `ExternalScope` を返す設計にしてあるため、本格運用では env ベースのスコープを
//           DB 管理の IntegrationKey（per-key スコープ/失効）に差し替えられる（今回は migration しない）。

import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import type { ApiError } from "@/types";

/** 空文字・空白のみを null 扱いに正規化する。 */
function normalize(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * 2 つの文字列を **定数時間** で比較する。
 * 長さの差でタイミングが変わらないよう、sha256 で固定長ダイジェスト化してから比較する。
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** 認証が通った外部リクエストに与えられるアクセススコープ。 */
export interface ExternalScope {
  /** allowlist の OA ID 群（空配列 = deny all）。 */
  readonly oaIds: string[];
  /** 指定 OA が allowlist に含まれるか。 */
  allowsOa(oaId: string): boolean;
}

export type ExternalAuthResult =
  | { ok: true; scope: ExternalScope }
  | { ok: false; response: NextResponse<ApiError> };

/** env `WHALE_EXTERNAL_OA_IDS`（カンマ区切り）から allowlist スコープを解決する。 */
function resolveScope(): ExternalScope {
  const raw = process.env.WHALE_EXTERNAL_OA_IDS ?? "";
  const oaIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const set = new Set(oaIds);
  return {
    oaIds,
    allowsOa: (oaId: string) => set.has(oaId),
  };
}

function unauthorized(): NextResponse<ApiError> {
  return NextResponse.json(
    { success: false, error: { code: "UNAUTHORIZED", message: "APIキーが無効です" } },
    { status: 401 },
  );
}

/** 設定不備（APIキー未設定）。詳細は body に出さず server log にのみ残す。 */
function configError(detail: string): NextResponse<ApiError> {
  console.error("[external-auth] config error:", detail);
  return NextResponse.json(
    { success: false, error: { code: "CONFIG_ERROR", message: "外部連携APIが未設定です" } },
    { status: 503 },
  );
}

/**
 * 外部連携 API のリクエストを検証する。
 *
 * - `WHALE_EXTERNAL_API_KEY` 未設定 → 503（fail closed）
 * - `x-whale-api-key` 欠落 or 不一致 → 401
 * - 一致 → `{ ok: true, scope }`（scope は WHALE_EXTERNAL_OA_IDS の allowlist）
 */
export function requireExternalApiKey(req: NextRequest): ExternalAuthResult {
  const expected = normalize(process.env.WHALE_EXTERNAL_API_KEY);
  if (!expected) {
    return { ok: false, response: configError("WHALE_EXTERNAL_API_KEY is not set") };
  }

  const provided = normalize(req.headers.get("x-whale-api-key"));
  if (!provided || !safeEqual(provided, expected)) {
    return { ok: false, response: unauthorized() };
  }

  return { ok: true, scope: resolveScope() };
}

/**
 * 外部連携 **書き込み** API（現状: チケットリンク mint のみ）専用の APIキー認証ガード。
 *
 * 読み取り API（works / phases / phase-links）が使う `WHALE_EXTERNAL_API_KEY` とは**別のキー**
 * `WHALE_EXTERNAL_WRITE_API_KEY` を要求し、read/write の権限を分離する（read キー漏えい時に
 * トークン発行=書き込みまで奪われないようにする）。
 *
 * - `WHALE_EXTERNAL_WRITE_API_KEY` 未設定 → 503（fail closed）。**read キーへフォールバックしない。**
 * - `x-whale-api-key` 欠落 or 不一致 → 401
 * - 一致 → `{ ok: true, scope }`（allowlist は read と共通の `WHALE_EXTERNAL_OA_IDS`）
 *
 * ※ 本番 env（`WHALE_EXTERNAL_WRITE_API_KEY`）の設定は運用側で行う。未設定の間 mint は 503 になる（安全側）。
 */
export function requireExternalWriteApiKey(req: NextRequest): ExternalAuthResult {
  const expected = normalize(process.env.WHALE_EXTERNAL_WRITE_API_KEY);
  if (!expected) {
    return { ok: false, response: configError("WHALE_EXTERNAL_WRITE_API_KEY is not set") };
  }

  const provided = normalize(req.headers.get("x-whale-api-key"));
  if (!provided || !safeEqual(provided, expected)) {
    return { ok: false, response: unauthorized() };
  }

  return { ok: true, scope: resolveScope() };
}
