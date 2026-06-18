// src/app/api/feedback/route.ts
// POST /api/feedback — フィードバック受信・Slack 通知
//
// 通知先の振り分け:
//   category === "enterprise" → ENTERPRISE_PLAN_SLACK_WEBHOOK_URL  (= apply-notify ch)
//   それ以外                 → FEEDBACK_SLACK_WEBHOOK_URL           (= feedback-notify ch)
//
// FEEDBACK_SLACK_WEBHOOK_URL が未設定の場合に限り、後方互換として
// GAS_FEEDBACK_WEBHOOK_URL (= 旧スプレッドシート連携) に fallback する。
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
import { prisma } from "@/lib/prisma";

// 送信者表示名をサーバー側で解決する (= client から渡された値は信用しない)。
// 認証済みユーザーの Profile を引き、優先順位で 1 つを返す:
//   1. username (= Whale Studio 上のユーザー名。存在すれば必ずこれ)
//   2. 氏名 (lastName + firstName)  ※ username 未設定時のみ
//   3. email                        ※ 上記いずれも無いとき
//   4. "未設定ユーザー"             ※ 匿名 / 取得不能時
async function resolveSenderName(
  userId: string | null,
  email:  string | null,
): Promise<string> {
  if (userId) {
    const profile = await prisma.profile
      .findUnique({
        where:  { userId },
        select: { username: true, lastName: true, firstName: true },
      })
      .catch(() => null);

    if (profile?.username?.trim()) return profile.username.trim();

    const fullName = [profile?.lastName, profile?.firstName]
      .filter((s) => s && s.trim())
      .join(" ")
      .trim();
    if (fullName) return fullName;
  }
  if (email?.trim()) return email.trim();
  return "未設定ユーザー";
}

// ユーザー向けの柔らかいエラー文言 (= webhook URL や env 名は出さない)
const USER_MSG_DEST_UNSET = "送信先の設定がまだ完了していません。管理者に連絡してください。";
const USER_MSG_SEND_FAILED = "送信に失敗しました。しばらく後にもう一度お試しください。";

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
  /** 法人プラン相談時の希望プラン表示名（"Basic" / "委託プラン" など）。それ以外は null。 */
  hoped_plan: string | null;
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

    // ── 送信者の解決（サーバー側 / client 入力は信用しない）────────────────────
    // 認証済みなら Supabase Auth user を取得し、Profile から username を解決する。
    // anonymous は userId=null → senderName="未設定ユーザー"（送信処理は継続）。
    const authUser    = await getAuthUser(req).catch(() => null);
    const userId      = authUser?.id ?? null;
    const senderEmail = authUser?.email ?? null;
    const senderName  = await resolveSenderName(userId, senderEmail);

    // ── ペイロード構築 ────────────────────────────────────────────────────────
    const userAgent = req.headers.get("user-agent") ?? "";
    const id        = randomUUID();

    const payload = {
      id,
      created_at:  new Date().toISOString(),
      // 送信者表示はサーバーで解決した値を使う（client の user_name/user_email は無視）。
      user_name:   senderName,
      user_email:  senderEmail ?? "",
      page_name:   body.page_name  ?? "",
      page_url:    body.page_url   ?? "",
      oa_id:       body.oa_id      ?? null,
      oa_name:     body.oa_name    ?? null,
      work_id:     body.work_id    ?? null,
      work_name:   body.work_name  ?? null,
      hoped_plan:  body.hoped_plan ?? null,
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

    // ──────────────────────────────────────────────────────────────────────────
    // 法人プラン申し込み (= apply-notify ch / ENTERPRISE_PLAN_SLACK_WEBHOOK_URL)
    // ──────────────────────────────────────────────────────────────────────────
    if (payload.category === "enterprise") {
      if (!process.env.ENTERPRISE_PLAN_SLACK_WEBHOOK_URL) {
        console.error(
          `[POST /api/feedback] [${requestId}] ❌ enterprise: ENTERPRISE_PLAN_SLACK_WEBHOOK_URL 未設定`
        );
        return NextResponse.json(
          { ok: false, error: USER_MSG_DEST_UNSET },
          { status: 500 }
        );
      }

      try {
        await notifyEnterpriseInquirySubmitted({
          id:        payload.id,
          content:   payload.content,
          userName:  payload.user_name  || null,
          userEmail: payload.user_email || null,
          userId,
          pageName:  payload.page_name  || null,
          pageUrl:   payload.page_url   || null,
          oaId:      payload.oa_id,
          oaName:    payload.oa_name,
          workId:    payload.work_id,
          workName:  payload.work_name,
          hopedPlan: payload.hoped_plan,
          createdAt: new Date(payload.created_at),
        });
      } catch (err) {
        console.error(
          `[POST /api/feedback] [${requestId}] ❌ enterprise slack 通知失敗:`,
          err
        );
        return NextResponse.json(
          { ok: false, error: USER_MSG_SEND_FAILED },
          { status: 500 }
        );
      }

      console.info(`[POST /api/feedback] [${requestId}] ✅ enterprise 完了 id=${id}`);
      return NextResponse.json({ ok: true });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 一般 feedback (= feedback-notify ch / FEEDBACK_SLACK_WEBHOOK_URL)
    //   - Slack を primary とする
    //   - FEEDBACK_SLACK_WEBHOOK_URL 未設定 のときに限り GAS にフォールバック
    //   - 両方未設定で FEEDBACK_DEV_SKIP も false ならユーザー向けにソフトエラー
    // ──────────────────────────────────────────────────────────────────────────
    const hasSlack  = !!process.env.FEEDBACK_SLACK_WEBHOOK_URL?.trim();
    const hasGas    = !!process.env.GAS_FEEDBACK_WEBHOOK_URL?.trim();
    const devSkip   = process.env.FEEDBACK_DEV_SKIP === "true";

    if (hasSlack) {
      try {
        await notifyFeedbackSubmitted({
          id:        payload.id,
          category:  payload.category,
          content:   payload.content,
          userId,
          userName:  payload.user_name  || null,
          userEmail: payload.user_email || null,
          pageName:  payload.page_name  || null,
          pageUrl:   payload.page_url   || null,
          oaId:      payload.oa_id,
          oaName:    payload.oa_name,
          workId:    payload.work_id,
          workName:  payload.work_name,
          createdAt: new Date(payload.created_at),
        });
      } catch (err) {
        console.error(
          `[POST /api/feedback] [${requestId}] ❌ feedback slack 通知失敗:`,
          err
        );
        return NextResponse.json(
          { ok: false, error: USER_MSG_SEND_FAILED },
          { status: 500 }
        );
      }

      console.info(`[POST /api/feedback] [${requestId}] ✅ feedback (slack) 完了 id=${id}`);
      return NextResponse.json({ ok: true });
    }

    if (hasGas || devSkip) {
      // 後方互換: Slack 未設定時のみ旧 GAS 経路を使う
      const result = await submitFeedback(payload);
      if (!result.ok) {
        console.error(
          `[POST /api/feedback] [${requestId}] ❌ GAS fallback 失敗: ${result.error}`
        );
        return NextResponse.json(
          { ok: false, error: USER_MSG_SEND_FAILED },
          { status: 500 }
        );
      }
      console.info(`[POST /api/feedback] [${requestId}] ✅ feedback (gas fallback) 完了 id=${id}`);
      return NextResponse.json({ ok: true, ...(result.dev_skip ? { dev_skip: true } : {}) });
    }

    // ── どちらの env も未設定 ───────────────────────────────────────────────
    console.error(
      `[POST /api/feedback] [${requestId}] ❌ feedback: FEEDBACK_SLACK_WEBHOOK_URL 未設定 ` +
      `(GAS_FEEDBACK_WEBHOOK_URL も未設定 / FEEDBACK_DEV_SKIP も false)`
    );
    return NextResponse.json(
      { ok: false, error: USER_MSG_DEST_UNSET },
      { status: 500 }
    );

  } catch (err) {
    console.error(`[POST /api/feedback] [${requestId}] ❌ 予期しない例外:`, err);
    return NextResponse.json(
      { ok: false, error: USER_MSG_SEND_FAILED },
      { status: 500 }
    );
  }
}
