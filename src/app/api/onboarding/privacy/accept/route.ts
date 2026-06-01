// src/app/api/onboarding/privacy/accept/route.ts
// POST /api/onboarding/privacy/accept — プライバシーポリシーに同意した記録を残す。
//
// 受信した privacy_policy_version が CURRENT_PRIVACY_POLICY_VERSION と一致しない場合は 400。
// @@unique([userId, privacyPolicyVersion]) で同じ version を重複保存しないので upsert を使う。
//
// 設計方針:
//   - 既存の `/api/onboarding/terms/accept` と同形 (= 認可 / バリデーション / レスポンス形式)
//   - 既存 acceptedAt は重複同意時に上書きしない (= 履歴として最初の同意日時を保持)

import { prisma } from "@/lib/prisma";
import { created, badRequest, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { acceptPrivacyPolicySchema } from "@/lib/validations/onboarding";
import { CURRENT_PRIVACY_POLICY_VERSION } from "@/lib/constants/privacy-policy";
import { formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json().catch(() => ({}));
    const data = acceptPrivacyPolicySchema.parse(body);

    if (data.privacy_policy_version !== CURRENT_PRIVACY_POLICY_VERSION) {
      return badRequest(
        `現在のプライバシーポリシーバージョンと一致しません (期待値: ${CURRENT_PRIVACY_POLICY_VERSION})`,
      );
    }

    const acceptance = await prisma.privacyPolicyAcceptance.upsert({
      where: {
        userId_privacyPolicyVersion: {
          userId:               user.id,
          privacyPolicyVersion: data.privacy_policy_version,
        },
      },
      create: {
        userId:               user.id,
        privacyPolicyVersion: data.privacy_policy_version,
      },
      update: {
        // 同じ (userId, privacyPolicyVersion) で重複同意した場合は何もしない
        // (= 既存 acceptedAt を維持して履歴として残す)
      },
    });

    return created({
      id:                     acceptance.id,
      privacy_policy_version: acceptance.privacyPolicyVersion,
      accepted_at:            acceptance.acceptedAt,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
