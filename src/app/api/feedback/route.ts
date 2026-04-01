// src/app/api/feedback/route.ts
// POST /api/feedback — フィードバック受信・GAS 転送
//
// レスポンス:
//   成功:         { ok: true }
//   成功(dev):    { ok: true, dev_skip: true }   ← FEEDBACK_DEV_SKIP=true 時のみ
//   バリデ失敗:   { ok: false, error: string }  HTTP 400
//   サーバーエラー: { ok: false, error: string }  HTTP 500

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { submitFeedback } from "@/lib/services/feedback";

// フロントから受け取る入力型（自動付与フィールドは除く）
interface FeedbackInput {
  content:    string;
  category:   string;
  page_name:  string;
  page_url:   string;
  user_name:  string;
  user_email: string;
  oa_id:      string | null;
  oa_name:    string | null;
  work_id:    string | null;
  work_name:  string | null;
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID().slice(0, 8); // ログ追跡用の短縮ID

  try {
    const body = await req.json() as Partial<FeedbackInput>;

    // ── バリデーション ────────────────────────────────────────────────────────
    if (!body.content?.trim()) {
      console.warn(`[POST /api/feedback] [${requestId}] ❌ バリデーション失敗: content 未入力`);
      return NextResponse.json({ ok: false, error: "content は必須です" }, { status: 400 });
    }

    const validCategories = ["bug", "ux", "feature", "other"];
    const category = validCategories.includes(body.category ?? "")
      ? body.category!
      : "other";

    // ── ペイロード構築 ────────────────────────────────────────────────────────
    const userAgent = req.headers.get("user-agent") ?? "";
    const id        = randomUUID();

    const payload = {
      id,
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

    console.info(
      `[POST /api/feedback] [${requestId}] 受信 id=${id} category=${category}` +
      ` page="${payload.page_name}" content_len=${payload.content.length}`
    );

    // ── GAS 送信 ──────────────────────────────────────────────────────────────
    const result = await submitFeedback(payload);

    if (!result.ok) {
      // GAS 側の失敗は 500 で返す（フロントにエラーを伝える）
      console.error(
        `[POST /api/feedback] [${requestId}] ❌ submitFeedback 失敗: ${result.error}`
      );
      return NextResponse.json(
        { ok: false, error: result.error ?? "送信に失敗しました" },
        { status: 500 }
      );
    }

    console.info(`[POST /api/feedback] [${requestId}] ✅ 完了 id=${id}`);

    // dev_skip フラグをフロントに伝えて開発モードメッセージを出せるようにする
    return NextResponse.json({ ok: true, ...(result.dev_skip ? { dev_skip: true } : {}) });

  } catch (err) {
    console.error(`[POST /api/feedback] [${requestId}] ❌ 予期しない例外:`, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
