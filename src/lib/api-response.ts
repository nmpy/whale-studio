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

export function conflict(message: string): NextResponse<ApiError> {
  return NextResponse.json(
    { success: false, error: { code: "CONFLICT", message } },
    { status: 409 }
  );
}

export function serverError(err: unknown): NextResponse<ApiError> {
  console.error("[API Error]", err);
  return NextResponse.json(
    { success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "サーバーエラーが発生しました" } },
    { status: 500 }
  );
}
