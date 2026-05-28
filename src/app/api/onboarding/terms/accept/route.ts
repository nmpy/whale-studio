// src/app/api/onboarding/terms/accept/route.ts
// POST /api/onboarding/terms/accept — 利用規約に同意した記録を残す。
//
// 受信した terms_version が CURRENT_TERMS_VERSION と一致しない場合は 400。
// @@unique([userId, termsVersion]) で同じ version を重複保存しないので upsert を使う。

import { prisma } from "@/lib/prisma";
import { created, badRequest, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { acceptTermsSchema } from "@/lib/validations/onboarding";
import { CURRENT_TERMS_VERSION } from "@/lib/constants/terms";
import { formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json().catch(() => ({}));
    const data = acceptTermsSchema.parse(body);

    if (data.terms_version !== CURRENT_TERMS_VERSION) {
      return badRequest(`現在の利用規約バージョンと一致しません (期待値: ${CURRENT_TERMS_VERSION})`);
    }

    const acceptance = await prisma.termsAcceptance.upsert({
      where: {
        userId_termsVersion: {
          userId:       user.id,
          termsVersion: data.terms_version,
        },
      },
      create: {
        userId:       user.id,
        termsVersion: data.terms_version,
      },
      update: {
        // 同じ (userId, termsVersion) で重複同意した場合は何もしない（既存 acceptedAt 維持）
      },
    });

    return created({
      id:             acceptance.id,
      terms_version:  acceptance.termsVersion,
      accepted_at:    acceptance.acceptedAt,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
