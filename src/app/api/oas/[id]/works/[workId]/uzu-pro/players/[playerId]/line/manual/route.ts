// POST   /api/oas/:id/works/:workId/uzu-pro/players/:playerId/line/manual — LINE User ID 手動登録
// DELETE /api/oas/:id/works/:workId/uzu-pro/players/:playerId/line/manual — LINE User ID 手動解除
//
// LIFF が利用できない緊急時の運用。認可は authorizeUzuProManager:
//   canAccessUzuPro（Work.uzuProEnabled ∧ UzuProGrant ∧ active member）AND LIFF 管理者 allowlist。
//   閲覧のみのユーザー / platform owner / Admin は（allowlist 外なら）404。
//
// セキュリティ:
//   - body は .strict()（想定外キー = PII 混入経路を 400 拒否）。lineUserId は形式検証 + 確認一致必須。
//   - 入力値（フル LINE User ID / reason）はログへ出さない。監査ログはマスク UID + 理由分類のみ。
//   - Player→Booking→Work はサーバー側で解決（クライアント申告の workId/bookingId を信用しない）。
//   - Work 無効化との TOCTOU は service 内で works 行 FOR UPDATE + 再検証。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, conflict, serverError } from "@/lib/api-response";
import { authorizeUzuProManager } from "@/lib/uzupro-auth";
import { manualLinkPlayerLineUser, manualUnlinkPlayerLineUser } from "@/lib/uzupro/line-link";
import { recordUzuProActivity, type UzuProAction } from "@/lib/uzupro/activity";
import { maskLineUserId } from "@/lib/mask";

export const dynamic = "force-dynamic";

// LINE User ID = "U" + 32 桁 hex（ID token の sub と整合）。大文字小文字は問わない。
// 過度に厳しくせず、公式仕様どおり長さ 33・先頭 U のみを要求する。
const LINE_USER_ID_RE = /^U[0-9a-fA-F]{32}$/;
const REASON_MAX = 500;

const trimmed = z.string().transform((s) => s.trim());

const linkSchema = z
  .object({
    lineUserId: trimmed.pipe(z.string().min(1).max(64)),
    lineUserIdConfirm: trimmed.pipe(z.string().min(1).max(64)),
    reason: trimmed.pipe(z.string().min(1, "理由は必須です").max(REASON_MAX)),
  })
  .strict()
  .refine((v) => LINE_USER_ID_RE.test(v.lineUserId), { path: ["lineUserId"], message: "LINE User ID の形式が不正です" })
  .refine((v) => v.lineUserId === v.lineUserIdConfirm, { path: ["lineUserIdConfirm"], message: "確認用と一致しません" });

const unlinkSchema = z
  .object({ reason: trimmed.pipe(z.string().min(1, "理由は必須です").max(REASON_MAX)) })
  .strict();

// 監査ログ（best-effort・PII 非含有: マスク UID / 理由 / 結果分類 / 内部ID は監査目的で可）。フル UID は保存しない。
async function safeActivity(a: {
  oaId: string;
  workId: string;
  actorUserId: string;
  action: UzuProAction;
  playerId: string;
  reason: string;
  maskedUid?: string;
  outcome?: string;
}) {
  try {
    await recordUzuProActivity(prisma, {
      oaId: a.oaId,
      workId: a.workId,
      actorUserId: a.actorUserId,
      action: a.action,
      targetType: "player",
      targetId: a.playerId,
      detail: {
        method: "manual",
        reason: a.reason,
        ...(a.maskedUid ? { lineUserMasked: a.maskedUid } : {}),
        ...(a.outcome ? { outcome: a.outcome } : {}),
      },
    });
  } catch {
    /* noop: 監査失敗は本応答を妨げない */
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; workId: string; playerId: string } },
) {
  const auth = await authorizeUzuProManager(req, params.id, params.workId);
  if (!auth.ok) return auth.response;

  let input: z.infer<typeof linkSchema>;
  try {
    input = linkSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力が不正です");
    return serverError(err);
  }

  try {
    const maskedUid = maskLineUserId(input.lineUserId);
    const result = await manualLinkPlayerLineUser({
      oaId: params.id,
      workId: params.workId,
      playerId: params.playerId,
      lineUserId: input.lineUserId,
    });

    const base = { oaId: params.id, workId: params.workId, actorUserId: auth.user.id, playerId: params.playerId, reason: input.reason };
    switch (result.kind) {
      case "linked":
        await safeActivity({ ...base, action: "line_manual_link_succeeded", maskedUid });
        return ok({ status: "linked" });
      case "already_linked_same":
        await safeActivity({ ...base, action: "line_manual_link_idempotent", maskedUid });
        return ok({ status: "already_linked" });
      case "conflict_other_account":
        await safeActivity({ ...base, action: "line_manual_link_conflict", outcome: "other_account" });
        return conflict("別の LINE アカウントが登録済みです。変更するには一度手動解除してください。");
      case "conflict_booking_duplicate":
        await safeActivity({ ...base, action: "line_manual_link_conflict", outcome: "booking_duplicate" });
        return conflict("同じ予約内の別プレイヤーに登録済みの LINE アカウントです。");
      case "work_disabled":
        await safeActivity({ ...base, action: "line_manual_link_failed", outcome: "work_disabled" });
        return conflict("この作品は for UZU Pro が無効化されているため登録できません。");
      case "player_not_found":
        await safeActivity({ ...base, action: "line_manual_link_failed", outcome: "player_not_found" });
        return notFound("プレイヤー");
    }
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; workId: string; playerId: string } },
) {
  const auth = await authorizeUzuProManager(req, params.id, params.workId);
  if (!auth.ok) return auth.response;

  let input: z.infer<typeof unlinkSchema>;
  try {
    input = unlinkSchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力が不正です");
    return serverError(err);
  }

  try {
    const result = await manualUnlinkPlayerLineUser({
      oaId: params.id,
      workId: params.workId,
      playerId: params.playerId,
    });
    const base = { oaId: params.id, workId: params.workId, actorUserId: auth.user.id, playerId: params.playerId, reason: input.reason };
    switch (result.kind) {
      case "unlinked":
        await safeActivity({ ...base, action: "line_manual_unlinked", outcome: "unlinked" });
        return ok({ status: "unlinked" });
      case "already_unlinked":
        await safeActivity({ ...base, action: "line_manual_unlinked", outcome: "already_unlinked" });
        return ok({ status: "already_unlinked" });
      case "player_not_found":
        await safeActivity({ ...base, action: "line_manual_unlink_failed", outcome: "player_not_found" });
        return notFound("プレイヤー");
    }
  } catch (err) {
    return serverError(err);
  }
}
