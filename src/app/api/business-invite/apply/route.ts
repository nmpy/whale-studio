// src/app/api/business-invite/apply/route.ts
// POST /api/business-invite/apply — 法人申込フォーム送信 (公開・未認証可)
//
// フロー:
//   1. token を hash して link を lookup。
//   2. state===active 以外 (none/used/expired/revoked) は 410 で拒否 (= 再申請不可)。
//   3. transaction で BusinessInviteApplication 作成 + link.usedAt をセット。
//      - linkId @unique + usedAt ガードで二重送信を防止 (= 競合は P2002 で弾く)。
//   4. Slack 通知 (= 失敗しても申請自体は成功扱い)。
//   5. **自動 OA 作成 / 権限付与 / 課金は一切行わない** (= 申請後に運営が手動対応)。

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  hashBusinessInviteToken,
  businessInviteState,
  applyBusinessInviteSchema,
  planTierLabel,
  roleLabel,
  usageTypeLabel,
} from "@/lib/business-invite";
import { notifyBusinessApplicationSubmitted } from "@/lib/slack/business-application";
import { ZodError } from "zod";

/** state に応じた申込不可エラー (= 410 Gone)。 */
function inviteUnavailable(state: string): NextResponse {
  const messageByState: Record<string, string> = {
    none:    "この申込リンクは無効です。発行元にお問い合わせください。",
    used:    "この申込リンクは既に申込済みです。重複して申し込むことはできません。",
    expired: "この申込リンクは有効期限が切れています。発行元にお問い合わせください。",
    revoked: "この申込リンクは無効化されています。発行元にお問い合わせください。",
  };
  const code = `BUSINESS_INVITE_${state.toUpperCase()}`;
  return NextResponse.json(
    { success: false, error: { code, message: messageByState[state] ?? "この申込リンクは利用できません。" } },
    { status: 410 },
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const data = applyBusinessInviteSchema.parse(body);

    const tokenHash = hashBusinessInviteToken(data.token);

    // 認証済みなら userId を任意付与 (= anonymous でも申込可)。
    const submittedByUserId = await getAuthUser(req)
      .then((u) => u?.id ?? null)
      .catch(() => null);

    const now = new Date();

    // ── transaction: 状態確認 → application 作成 → usedAt セット ──
    let created: {
      application: { id: string; createdAt: Date };
      link: { id: string; planTier: string; role: string; usageType: string };
    };
    try {
      created = await prisma.$transaction(async (tx) => {
        const link = await tx.businessInviteLink.findUnique({ where: { tokenHash } });
        const state = businessInviteState(link, now);
        if (!link || state !== "active") {
          // transaction 内から状態を投げ、外側で 410 に変換
          throw new BusinessInviteStateError(state);
        }

        const application = await tx.businessInviteApplication.create({
          data: {
            linkId:                  link.id,
            companyName:             data.companyName,
            contactName:             data.contactName,
            contactEmail:            data.contactEmail,
            lineOfficialAccountName: data.lineOfficialAccountName ?? null,
            message:                 data.message ?? null,
            // 申込時点のスナップショット (= 後で link が変わっても保全)
            snapshotPlanTier:  link.planTier,
            snapshotRole:      link.role,
            snapshotUsageType: link.usageType,
            submittedByUserId,
          },
          select: { id: true, createdAt: true },
        });

        await tx.businessInviteLink.update({
          where: { id: link.id },
          data:  { usedAt: now },
        });

        return {
          application,
          link: { id: link.id, planTier: link.planTier, role: link.role, usageType: link.usageType },
        };
      });
    } catch (txErr) {
      if (txErr instanceof BusinessInviteStateError) {
        return inviteUnavailable(txErr.state);
      }
      // 二重送信などで linkId @unique 制約に当たった場合 = 既に申込済み
      if (txErr instanceof Prisma.PrismaClientKnownRequestError && txErr.code === "P2002") {
        return inviteUnavailable("used");
      }
      throw txErr;
    }

    // ── Slack 通知 (= 失敗しても申請は成功扱い) ──
    try {
      await notifyBusinessApplicationSubmitted({
        applicationId:           created.application.id,
        linkId:                  created.link.id,
        companyName:             data.companyName,
        contactName:             data.contactName,
        contactEmail:            data.contactEmail,
        lineOfficialAccountName: data.lineOfficialAccountName ?? null,
        message:                 data.message ?? null,
        planLabel:               planTierLabel(created.link.planTier),
        roleLabel:               roleLabel(created.link.role),
        usageTypeLabel:          usageTypeLabel(created.link.usageType),
        submittedByUserId,
        createdAt:               created.application.createdAt,
      });
    } catch (slackErr) {
      console.error("[business-invite/apply] Slack 通知失敗 (申請は成功):", slackErr);
    }

    return ok({ submitted: true });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です");
    return serverError(err);
  }
}

/** transaction 内で state 不正を伝搬するための内部エラー。 */
class BusinessInviteStateError extends Error {
  constructor(public state: string) {
    super(`business invite not applicable: ${state}`);
    this.name = "BusinessInviteStateError";
  }
}
