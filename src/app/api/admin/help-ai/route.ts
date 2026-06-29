// src/app/api/admin/help-ai/route.ts
// POST /api/admin/help-ai — 管理画面ヘルプAI（MVP）。
//
// - 認証: withAuth（ログイン必須・未ログインは 401）
// - 機能フラグ: ENABLE_ADMIN_HELP_AI !== "true" は 404（機能が存在しない扱い）
// - OPENAI_API_KEY 未設定は 503
// - question 空 / 1000 文字超は 400
// - OpenAI Responses API をサーバ側で fetch（SDK 非依存）。キー・エラー詳細はクライアントに返さない。
// - 失敗してもアプリ全体をクラッシュさせない（安全な汎用エラーを返す）。
//
// AI に渡すのは「絞り込んだ固定ヘルプ知識 + 画面情報(pathname/title/type) + 質問」のみ。
// 個人情報・内部ID・本文・secret は渡さない。回答ログ/質問全文はサーバログに出さない。

import { NextRequest, NextResponse } from "next/server";
import { ok, badRequest, notFound } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { ADMIN_HELP_QUESTION_MAX } from "@/lib/admin-help/types";
import { selectKnowledge } from "@/lib/admin-help/select-knowledge";
import { buildSystemPrompt, buildInput, ADMIN_HELP_SUGGESTED_QUESTIONS } from "@/lib/admin-help/prompt";

export const dynamic = "force-dynamic";

const DEFAULT_HELP_AI_MODEL = "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 20_000;

function serviceUnavailable(message: string): NextResponse {
  return NextResponse.json(
    { success: false, error: { code: "SERVICE_UNAVAILABLE", message } },
    { status: 503 },
  );
}
function aiError(): NextResponse {
  // クライアントには詳細を返さない（汎用文言のみ）。
  return NextResponse.json(
    { success: false, error: { code: "HELP_AI_ERROR", message: "回答を生成できませんでした。少し時間をおいて再度お試しください。" } },
    { status: 502 },
  );
}

/** Responses API のレスポンスから回答テキストを安全に取り出す。 */
function extractAnswer(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const j = json as { output_text?: unknown; output?: unknown };
  if (typeof j.output_text === "string" && j.output_text.trim()) return j.output_text.trim();
  if (Array.isArray(j.output)) {
    const parts: string[] = [];
    for (const item of j.output) {
      const content = (item as { content?: unknown })?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          const t = (c as { text?: unknown; type?: unknown });
          if (typeof t.text === "string") parts.push(t.text);
        }
      }
    }
    return parts.join("").trim();
  }
  return "";
}

export const POST = withAuth(async (req: NextRequest) => {
  // 機能フラグ OFF → 機能なし扱い（404）。
  if (process.env.ENABLE_ADMIN_HELP_AI !== "true") {
    return notFound("ヘルプAI");
  }

  // 入力バリデーション（本文・内部IDは扱わない）。
  let body: { question?: unknown; pathname?: unknown; pageTitle?: unknown; contextType?: unknown } | null;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return badRequest("リクエスト形式が不正です");
  }
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return badRequest("質問を入力してください");
  if (question.length > ADMIN_HELP_QUESTION_MAX) {
    return badRequest(`質問は ${ADMIN_HELP_QUESTION_MAX} 文字以内で入力してください`);
  }
  const pathname    = typeof body?.pathname === "string"    ? body.pathname.slice(0, 200)    : undefined;
  const pageTitle   = typeof body?.pageTitle === "string"   ? body.pageTitle.slice(0, 120)   : undefined;
  const contextType = typeof body?.contextType === "string" ? body.contextType.slice(0, 60)  : undefined;

  // OpenAI キー未設定 → 503（アプリは壊さない）。
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return serviceUnavailable("ヘルプAIは現在利用できません（未設定）");

  const model = process.env.OPENAI_HELP_AI_MODEL || DEFAULT_HELP_AI_MODEL;
  const knowledge = selectKnowledge(question, pathname, contextType);
  const instructions = buildSystemPrompt();
  const input = buildInput(question, knowledge, { pathname, pageTitle, contextType });

  // 質問全文・個人情報はログに出さない（長さと選択カテゴリのみ）。
  console.info(`[help-ai] q.len=${question.length} categories=${knowledge.map((k) => k.id).join(",")}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions,
        input,
        temperature: 0.2,
        max_output_tokens: 900,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // OpenAI のエラー詳細はクライアントに返さない（status のみログ）。
      console.warn(`[help-ai] OpenAI responded status=${res.status}`);
      return aiError();
    }

    const json = await res.json();
    const answer = extractAnswer(json);
    if (!answer) {
      console.warn("[help-ai] empty answer from OpenAI");
      return aiError();
    }

    return ok({ answer, suggestedQuestions: ADMIN_HELP_SUGGESTED_QUESTIONS });
  } catch (err) {
    // タイムアウト/通信失敗等。詳細は返さない。
    console.warn(`[help-ai] request failed: ${err instanceof Error ? err.name : "unknown"}`);
    return aiError();
  } finally {
    clearTimeout(timeout);
  }
});
