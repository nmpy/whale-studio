// src/app/api/feedback/route.ts
// POST /api/feedback — フィードバック受信・GAS 転送
//
// レスポンス:
//   成功: { ok: true }
//   失敗: { ok: false, error: string }

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { submitFeedback } from "@/lib/services/feedback";

// フロントから受け取る入力型（自動付与フィールドは除く）
interface FeedbackInput {
  content:   string;
  category:  string;
  page_name: string;
  page_url:  string;
  user_name:  string;
  user_email: string;
  oa_id:     string | null;
  oa_name:   string | null;
  work_id:   string | null;
  work_name: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<FeedbackInput>;

    // バリデーション
    if (!body.content?.trim()) {
      return NextResponse.json({ ok: false, error: "content は必須です" }, { status: 400 });
    }

    const validCategories = ["bug", "ux", "feature", "other"];
    const category = validCategories.includes(body.category ?? "")
      ? body.category!
      : "other";

    // user-agent はリクエストヘッダーから取得
    const userAgent = req.headers.get("user-agent") ?? "";

    const payload = {
      id:          randomUUID(),
      created_at:  new Date().toISOString(),
      user_name:   body.user_name  ?? "",
      user_email:  body.user_email ?? "",
      page_name:   body.page_name  ?? "",
      page_url:    body.page_url   ?? "",
      oa_id:       body.oa_id      ?? null,
      oa_name:     body.oa_name    ?? null,
      work_id:     body.work_id    ?? null,
      work_name:   body.work_name  ?? null,
      category,
      content:     body.content.trim(),
      status:      "未対応",
      memo:        "",
      user_agent:  userAgent,
    };

    const result = await submitFeedback(payload);

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "送信に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/feedback]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
