// src/app/api/auth/register-consent/route.ts
// POST /api/auth/register-consent
//   初回登録（Supabase signUp）でセッションが取れた直後にクライアントから呼ぶ。
//   ユーザー名・利用規約同意・プライバシーポリシー同意をサーバー側で必須チェックし、
//   同意ログ（UserConsentLog）+ プロフィール + 同意ゲート（acceptance）を 1 transaction で記録する。
//
// 注意:
//   - email / password の検証・ハッシュ化は Supabase Auth が担う（このルートは signUp 成功後に呼ばれる）。
//   - メール確認 ON でセッションが取れない場合は、signUp の user_metadata に同意情報を載せ、
//     初回認証時に onboarding ガード側で materialize する（このルートは呼ばれない）。

import { created, badRequest, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { registerConsentSchema } from "@/lib/validations/onboarding";
import { formatZodErrors } from "@/lib/validations";
import { recordRegistrationConsent, clientIpFromHeaders } from "@/lib/consent";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json().catch(() => ({}));
    const data = registerConsentSchema.parse(body);

    // サーバー側でも必須チェック（フロントだけに依存しない）。
    const username = (data.username ?? "").trim();
    if (!username) return badRequest("ユーザー名を入力してください");
    if (username.length > 20) return badRequest("ユーザー名は20文字以内で入力してください");
    if (data.terms_agreed !== true) return badRequest("利用規約への同意が必要です");
    if (data.privacy_agreed !== true) return badRequest("プライバシーポリシーへの同意が必要です");

    await recordRegistrationConsent({
      userId:   user.id,
      username,
      meta: {
        ipAddress: clientIpFromHeaders(req.headers),
        userAgent: req.headers.get("user-agent"),
      },
    });

    return created({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
