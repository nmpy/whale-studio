// src/lib/api-response.ts
// API レスポンスヘルパー

import { NextResponse } from "next/server";
import type { ApiSuccess, ApiError } from "@/types";

export function ok<T>(data: T, meta?: Record<string, unknown>, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data, ...(meta ? { meta } : {}) }, { status });
}

export function created<T>(data: T): NextResponse<ApiSuccess<T>> {
  return ok(data, undefined, 201);
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function badRequest(message: string, details?: Record<string, string[]>): NextResponse<ApiError> {
  return NextResponse.json(
    { success: false, error: { code: "BAD_REQUEST", message, ...(details ? { details } : {}) } },
    { status: 400 }
  );
}

export function notFound(resource: string): NextResponse<ApiError> {
  return NextResponse.json(
    { success: false, error: { code: "NOT_FOUND", message: `${resource} が見つかりません` } },
    { status: 404 }
  );
}

export function forbidden(): NextResponse<ApiError> {
  return NextResponse.json(
    { success: false, error: { code: "FORBIDDEN", message: "アクセスが拒否されました" } },
    { status: 403 }
  );
}

/**
 * プラン不足によるアクセス拒否レスポンス (= 403 + PLAN_REQUIRED)。
 *
 * UI 側の `getPlanAccessState` と shape を揃え、UI / API で同じ判定結果が
 * 共有できるようにする。
 *
 * details の値は **string** にする (= 単一値の付加情報なので array は不要)。
 * 既存の Zod error 系 (= `badRequest`) は引き続き array を使えるよう、
 * `ApiError.details` は `Record<string, string | string[]>` で両対応する。 */
export function planRequired(args: {
  requiredPlan: string;       // = PlanTier "basic" | "standard" | "plus" | "pro"
  requiredPlanLabel: string;  // = "Basic" / "Standard" / "Plus" / "Pro"
  message?: string;
}): NextResponse<ApiError> {
  const message = args.message ?? `この機能は${args.requiredPlanLabel}プラン以上で利用できます`;
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "PLAN_REQUIRED",
        message,
        details: {
          requiredPlan:      args.requiredPlan,
          requiredPlanLabel: args.requiredPlanLabel,
        },
      },
    },
    { status: 403 },
  );
}

export function conflict(message: string): NextResponse<ApiError> {
  return NextResponse.json(
    { success: false, error: { code: "CONFLICT", message } },
    { status: 409 }
  );
}

/**
 * 422 Unprocessable Entity。
 * body の構文は正しい（Zod は通る）が、ドメイン規則上保存できない場合に使う
 * （例: 連続メッセージ内に自由入力が複数 / 削除対象が他から参照されている）。
 * code はドメイン側のコードを渡せる（既定 UNPROCESSABLE）。
 */
export function unprocessable(message: string, code = "UNPROCESSABLE", details?: Record<string, unknown>): NextResponse<ApiError> {
  return NextResponse.json(
    { success: false, error: { code, message, ...(details ? { details } : {}) } } as ApiError,
    { status: 422 }
  );
}

export function serverError(err: unknown): NextResponse<ApiError> {
  console.error("[API Error]", err);
  return NextResponse.json(
    { success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "サーバーエラーが発生しました" } },
    { status: 500 }
  );
}
