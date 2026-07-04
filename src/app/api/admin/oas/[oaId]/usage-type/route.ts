// src/app/api/admin/oas/[oaId]/usage-type/route.ts
// PATCH /api/admin/oas/[oaId]/usage-type — 対象アカウント（OA）の利用区分（個人/法人）を手動変更。
//
// 目的:
//   - 法人招待 URL の期限切れ等で usageType が反映されなかった場合に、運営が正規の管理導線から
//     Oa.usageType を personal / business に更新できるようにする（再招待や DB 直接更新に頼らない）。
//   - 判定は Oa.usageType が正（PR #524 の料金プラン見出し出し分けもこれを参照）。作品名/プラン名/
//     特定 OA ID では判定・分岐しない。
//
// 影響範囲（OA 全体）:
//   - 料金プラン画面の見出し（個人利用プラン / 法人利用プラン）と個人/法人カードの出し分け
//   - 招待 URL 一覧・設定画面の利用区分表示 等
//   → ユーザー個人ではなく「対象アカウント（OA）単位」の変更。
//
// 権限: platform admin のみ（スタジオ管理ユーザー画面と同一ガード）。非該当は 404 で秘匿。
//   フロントの制御に依存せず、この API 側でも必ずチェックする。migration なし（既存 Oa.usageType を更新）。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";
import { usageTypeSchema } from "@/lib/usage-type";
import { z, ZodError } from "zod";

const bodySchema = z.object({ usage_type: usageTypeSchema });

export const PATCH = withAuth<{ oaId: string }>(async (req: NextRequest, ctx, user) => {
  try {
    // platform admin 限定（workspace owner も不可）。非該当は存在を秘匿して 404。
    if (!isPlatformOwner(user.id)) return notFound("ページ");

    const oa = await prisma.oa.findUnique({
      where:  { id: ctx.params.oaId },
      select: { id: true, title: true, usageType: true },
    });
    if (!oa) return notFound("アカウント");

    const body = await req.json();
    const { usage_type } = bodySchema.parse(body);

    const updated = await prisma.oa.update({
      where:  { id: oa.id },
      data:   { usageType: usage_type },
      select: { id: true, title: true, usageType: true },
    });

    // 監査ログ（運営の手動変更を記録）。失敗しても本処理は止めない。
    await prisma.adminAuditLog.create({
      data: { actorId: user.id, action: "update", resource: "oa_usage_type", resourceId: oa.id },
    }).catch(() => { /* noop */ });

    return ok({ id: updated.id, title: updated.title, usage_type: updated.usageType });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です");
    return serverError(err);
  }
});
