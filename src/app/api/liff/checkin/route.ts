// src/app/api/liff/checkin/route.ts
// POST /api/liff/checkin — LIFF ロケーションチェックイン（プレイヤー向け・認証不要）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { checkinSchema, formatZodErrors } from "@/lib/validations";
import { applySetFlags, evaluateCondition } from "@/lib/runtime";
import { ZodError } from "zod";
import type { CheckinSuccess, CheckinCooldown } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = checkinSchema.parse(body);

    // ── 1. ロケーション取得 ──
    const location = await prisma.location.findUnique({
      where: { id: data.location_id },
      include: {
        transition: {
          include: {
            toPhase: { select: { id: true, name: true, phaseType: true } },
          },
        },
      },
    });
    if (!location) return notFound("ロケーション");
    if (!location.isActive) return badRequest("このロケーションは現在無効です");
    if (location.workId !== data.work_id) return badRequest("ロケーションが指定作品に属していません");

    // ── 2. ユー��ー進行状態を取得 ──
    const progress = await prisma.userProgress.findUnique({
      where: {
        lineUserId_workId: {
          lineUserId: data.line_user_id,
          workId:     data.work_id,
        },
      },
    });
    if (!progress) {
      return badRequest("シナリオが開始されていません。まずシナリオを開始してください。");
    }
    if (progress.reachedEnding) {
      return badRequest("シナリオは既に完了しています");
    }

    // ── 3. クー��ダウンチェック ──
    const lastVisit = await prisma.locationVisit.findFirst({
      where: {
        lineUserId: data.line_user_id,
        locationId: data.location_id,
      },
      orderBy: { visitedAt: "desc" },
    });
    if (lastVisit) {
      const elapsedSeconds = (Date.now() - lastVisit.visitedAt.getTime()) / 1000;
      if (elapsedSeconds < location.cooldownSeconds) {
        const remaining = Math.ceil(location.cooldownSeconds - elapsedSeconds);
        return ok<CheckinCooldown>({
          success:     true,
          status:      "cooldown",
          location_id: data.location_id,
          work_id:     data.work_id,
          location_name: location.name,
          message:     `あと${formatCooldown(remaining)}で再チェックインできます`,
          cooldown_remaining_seconds: remaining,
        });
      }
    }

    // ── 4. チェックイン処理（トランザクション） ──
    let currentFlags: Record<string, unknown> = {};
    try { currentFlags = JSON.parse(progress.flags); } catch { /* ignore */ }

    let newFlags = currentFlags;
    let newPhaseId = progress.currentPhaseId;
    let reachedEnding: boolean = progress.reachedEnding;
    let transitionPhase: { id: string; name: string; phaseType: string } | undefined;
    let flagsApplied: Record<string, unknown> | undefined;

    // フラグ適用
    if (location.setFlags && location.setFlags !== "{}") {
      newFlags = applySetFlags(currentFlags, location.setFlags);
      try { flagsApplied = JSON.parse(location.setFlags); } catch { /* ignore */ }
    }

    // 遷移の発火
    if (location.transition) {
      const t = location.transition;
      if (t.fromPhaseId === progress.currentPhaseId) {
        if (t.isActive && evaluateCondition(newFlags, t.flagCondition)) {
          newPhaseId = t.toPhaseId;
          if (t.setFlags && t.setFlags !== "{}") {
            newFlags = applySetFlags(newFlags, t.setFlags);
          }
          if (t.toPhase?.phaseType === "ending") {
            reachedEnding = true;
          }
          transitionPhase = t.toPhase ?? undefined;
        }
      }
    }

    await prisma.$transaction([
      prisma.locationVisit.create({
        data: {
          lineUserId: data.line_user_id,
          locationId: data.location_id,
          workId:     data.work_id,
        },
      }),
      prisma.userProgress.update({
        where: {
          lineUserId_workId: {
            lineUserId: data.line_user_id,
            workId:     data.work_id,
          },
        },
        data: {
          currentPhaseId:   newPhaseId,
          reachedEnding,
          flags:            JSON.stringify(newFlags),
          lastInteractedAt: new Date(),
        },
      }),
    ]);

    // ── 5. レスポンス ──
    return ok<CheckinSuccess>({
      success:     true,
      status:      "checked_in",
      location_id: data.location_id,
      work_id:     data.work_id,
      location_name: location.name,
      message:     transitionPhase
        ? `${location.name}に��ェックインしました。${transitionPhase.name}に進みます。`
        : `${location.name}にチェックイン��ました`,
      cooldown_remaining_seconds: 0,
      ...(transitionPhase && {
        transition: {
          id:         transitionPhase.id,
          name:       transitionPhase.name,
          phase_type: transitionPhase.phaseType,
        },
      }),
      ...(flagsApplied && { flags_applied: flagsApplied }),
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
}

function formatCooldown(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const m = Math.ceil(seconds / 60);
  return `約${m}分`;
}
