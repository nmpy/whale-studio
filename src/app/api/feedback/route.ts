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
import { notifyFeedbackSubmitted } from "@/lib/slack/feedback";
import { notifyEnterpriseInquirySubmitted } from "@/lib/slack/enterprise-inquiry";
import { getAuthUser } from "@/lib/auth";

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

    // "enterprise" は /pricing の「法人プランに申し込む」CTA からの送信に使う。
    // 受け取った場合は専用 Slack チャネル (= ENTERPRISE_PLAN_SLACK_WEBHOOK_URL) に通知する。
    const validCategories = ["bug", "ux", "feature", "other", "enterprise"];
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

    // Slack 通知 (fire-and-forget):
    //   - webhook 未設定なら silent no-op
    //   - 通知失敗時もレスポンスはブロックしない (= console.error のみ)
    //   - webhook URL はログに出さない (= helper 側で吸収)
    //
    // category 別に通知先を分岐:
    //   - "enterprise" → ENTERPRISE_PLAN_SLACK_WEBHOOK_URL (= 法人プラン申し込み専用)
    //   - その他       → FEEDBACK_SLACK_WEBHOOK_URL (= 一般気づき)
    if (payload.category === "enterprise") {
      // 認証済みなら userId を取得 (= 任意。anonymous なら null)。
      // getAuthUser は失敗時も throw しない設計だが、念のため try/catch で吸収。
      const inquiryUserId = await getAuthUser(req).then((u) => u?.id ?? null).catch(() => null);
      void notifyEnterpriseInquirySubmitted({
        id:        payload.id,
        content:   payload.content,
        userName:  payload.user_name  || null,
        userEmail: payload.user_email || null,
        userId:    inquiryUserId,
        pageName:  payload.page_name  || null,
        pageUrl:   payload.page_url   || null,
        oaId:      payload.oa_id,
        oaName:    payload.oa_name,
        workId:    payload.work_id,
        workName:  payload.work_name,
        createdAt: new Date(payload.created_at),
      }).catch((err) => {
        console.error("[slack] failed to notify enterprise inquiry", err);
      });
    } else {
      void notifyFeedbackSubmitted({
        id:        payload.id,
        category:  payload.category,
        content:   payload.content,
        userName:  payload.user_name  || null,
        userEmail: payload.user_email || null,
        pageName:  payload.page_name  || null,
        pageUrl:   payload.page_url   || null,
        oaId:      payload.oa_id,
        oaName:    payload.oa_name,
        workId:    payload.work_id,
        workName:  payload.work_name,
        createdAt: new Date(payload.created_at),
      }).catch((err) => {
        console.error("[slack] failed to notify feedback", err);
      });
    }

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
