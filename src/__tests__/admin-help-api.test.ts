// src/__tests__/admin-help-api.test.ts
// POST /api/admin/help-ai のガード・正常・エラー処理の検証。
// 注: 未ログイン 401 は withAuth（共通・別テストで担保）の責務のため、本テストでは認証済み前提でルートロジックを検証する。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// withAuth は素通り（認証済みユーザー）。
vi.mock("@/lib/auth", () => ({
  withAuth: <T>(h: (req: unknown, ctx: { params: T }, u: { id: string }) => Promise<unknown>) =>
    (req: unknown, ctx: { params: T }) => h(req, ctx, { id: "user-1" }),
}));

const ORIGINAL_ENV = { ...process.env };
function req(body: unknown) {
  return new Request("http://localhost/api/admin/help-ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("feature flag / 入力バリデーション", () => {
  it("flag OFF → 404", async () => {
    process.env.ENABLE_ADMIN_HELP_AI = "false";
    const { POST } = await import("@/app/api/admin/help-ai/route");
    const res = await POST(req({ question: "クイックリプライとは？" }), { params: {} } as never);
    expect((res as Response).status).toBe(404);
  });

  it("flag ON・question 空 → 400", async () => {
    process.env.ENABLE_ADMIN_HELP_AI = "true";
    process.env.OPENAI_API_KEY = "sk-test";
    const { POST } = await import("@/app/api/admin/help-ai/route");
    const res = await POST(req({ question: "   " }), { params: {} } as never);
    expect((res as Response).status).toBe(400);
  });

  it("flag ON・question 長すぎ → 400", async () => {
    process.env.ENABLE_ADMIN_HELP_AI = "true";
    process.env.OPENAI_API_KEY = "sk-test";
    const { POST } = await import("@/app/api/admin/help-ai/route");
    const res = await POST(req({ question: "あ".repeat(1001) }), { params: {} } as never);
    expect((res as Response).status).toBe(400);
  });

  it("flag ON・OPENAI_API_KEY 未設定 → 503", async () => {
    process.env.ENABLE_ADMIN_HELP_AI = "true";
    delete process.env.OPENAI_API_KEY;
    const { POST } = await import("@/app/api/admin/help-ai/route");
    const res = await POST(req({ question: "クイックリプライとは？" }), { params: {} } as never);
    expect((res as Response).status).toBe(503);
  });
});

describe("OpenAI 呼び出し", () => {
  beforeEach(() => {
    process.env.ENABLE_ADMIN_HELP_AI = "true";
    process.env.OPENAI_API_KEY = "sk-test";
  });

  it("正常時 → 200・answer を返す（output 配列から抽出）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ output: [{ content: [{ type: "output_text", text: "クイックリプライは選択肢ボタンです。" }] }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    const { POST } = await import("@/app/api/admin/help-ai/route");
    const res = await POST(req({ question: "クイックリプライとは？", pathname: "/oas/x/works/y/messages" }), { params: {} } as never);
    expect((res as Response).status).toBe(200);
    const j = await (res as Response).json();
    expect(j.data.answer).toContain("クイックリプライ");
    expect(Array.isArray(j.data.suggestedQuestions)).toBe(true);
  });

  it("OpenAI が非200 → 502（詳細は返さない汎用エラー）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    const { POST } = await import("@/app/api/admin/help-ai/route");
    const res = await POST(req({ question: "ヒントを出したい" }), { params: {} } as never);
    expect((res as Response).status).toBe(502);
    const j = await (res as Response).json();
    expect(j.error.message).not.toContain("rate limited"); // 詳細を漏らさない
  });

  it("fetch 例外（タイムアウト等）→ 502・クラッシュしない", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("aborted"); }));
    const { POST } = await import("@/app/api/admin/help-ai/route");
    const res = await POST(req({ question: "LIFFを公開したい" }), { params: {} } as never);
    expect((res as Response).status).toBe(502);
  });
});
