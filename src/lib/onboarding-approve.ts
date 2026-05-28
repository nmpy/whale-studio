// src/lib/onboarding-approve.ts
// OaOnboardingRequest の承認時に、対応する Oa + WorkspaceMember(owner) を作成する helper。
//
// 既存 `POST /api/oas` の transaction と挙動を揃え、承認後のユーザーが従来通り
// /oas を利用できる状態にする。

import { prisma } from "@/lib/prisma";
import { createTesterSubscription } from "@/lib/billing/create-tester-subscription";
import type { OaOnboardingRequest } from "@prisma/client";

export interface ApproveResult {
  oaId: string;
}

/**
 * 承認時の作成処理。
 *
 * - Oa を作成し ownerKey = req.userId
 * - WorkspaceMember を owner ロールで作成
 * - OaOnboardingRequest を APPROVED + oaId 紐付け + reviewedAt/reviewedBy を更新
 * - tester subscription を fire-and-forget で起票
 *
 * 必須項目（oaName / channelId / channelSecret / channelToken）が欠けている場合は
 * Error を throw する。
 */
export async function approveOnboardingRequest(args: {
  request: OaOnboardingRequest;
  reviewerUserId: string;
}): Promise<ApproveResult> {
  const { request, reviewerUserId } = args;

  if (!request.oaName || !request.channelId || !request.channelSecret || !request.channelToken) {
    throw new Error("承認には oaName / channelId / channelSecret / channelToken が必須です");
  }

  const oa = await prisma.$transaction(async (tx) => {
    // ── 二重承認の race condition 防止 ──
    // 事前 findUnique と transaction の間で別リクエストが APPROVED に進めた場合、
    // ここで最新ステータスを読み直し、既に APPROVED ないし oaId が紐付いていれば
    // 例外を投げて transaction 全体を rollback する。
    const fresh = await tx.oaOnboardingRequest.findUnique({
      where: { id: request.id },
      select: { status: true, oaId: true },
    });
    if (!fresh) {
      throw new Error("承認対象の申請が見つかりません");
    }
    if (fresh.status === "APPROVED" || fresh.oaId) {
      throw new Error("既に承認済みです (二重承認をブロックしました)");
    }

    const newOa = await tx.oa.create({
      data: {
        title:              request.oaName!,
        channelId:          request.channelId!,
        channelSecret:      request.channelSecret!,
        channelAccessToken: request.channelToken!,
        lineOaId:           request.basicId ?? null,
        publishStatus:      "draft",
        ownerKey:           request.userId,
      },
    });

    await tx.workspaceMember.create({
      data: {
        workspaceId: newOa.id,
        userId:      request.userId,
        role:        "owner",
        invitedBy:   reviewerUserId,
      },
    });

    await tx.oaOnboardingRequest.update({
      where: { id: request.id },
      data: {
        status:     "APPROVED",
        oaId:       newOa.id,
        reviewedAt: new Date(),
        reviewedBy: reviewerUserId,
      },
    });

    console.log("[onboarding-approve] approved", {
      requestId:  request.id,
      userId:     request.userId,
      oaId:       newOa.id,
      reviewedBy: reviewerUserId,
    });

    return newOa;
  });

  // tester subscription を fire-and-forget で起票（既存 POST /api/oas と同じ挙動）
  createTesterSubscription(oa.id).catch((e) =>
    console.error("[onboarding-approve] subscription auto-create failed:", e)
  );

  return { oaId: oa.id };
}
