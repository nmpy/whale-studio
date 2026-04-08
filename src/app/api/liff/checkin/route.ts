// src/app/api/liff/checkin/route.ts
// POST /api/liff/checkin — LIFF ロケーションチェックイン（プレイヤー向け・認証不要）
// 対応方式: QR / GPS / Beacon

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { checkinSchema, formatZodErrors } from "@/lib/validations";
import { applySetFlags, evaluateCondition } from "@/lib/runtime";
import { isWithinRadius } from "@/lib/geo";
import { ZodError } from "zod";
import type { CheckinSuccess, CheckinCooldown, CheckinOutOfRange, CheckinMethod, StampInfo } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = checkinSchema.parse(body);
    const method: CheckinMethod = data.checkin_method ?? "qr";

    // ── 1. ロケーション取得 ──
    const location = await prisma.location.findUnique({
      where: { id: data.location_id },
      include: {
        transition: {
          include: { toPhase: { select: { id: true, name: true, phaseType: true } } },
        },
      },
    });
    if (!location) return notFound("ロケーション");
    if (!location.isActive) return badRequest("このロケーションは現在無効です");
    if (location.workId !== data.work_id) return badRequest("ロケーションが指定作品に属していません");

    // ── 2. GPS 判定 ──
    let distanceMeters: number | undefined;
    if (method === "gps") {
      if (!location.gpsEnabled) {
        return badRequest("この地点は GPS チェックインに対応していません");
      }
      if (location.latitude == null || location.longitude == null || location.radiusMeters == null) {
        return badRequest("このロケーションの GPS 設定が不完全です（座標または半径が未設定）");
      }
      if (data.lat == null || data.lng == null) {
        return badRequest("GPS チェックインには緯度・経度が必要です");
      }
      const geo = isWithinRadius(data.lat, data.lng, location.latitude, location.longitude, location.radiusMeters);
      distanceMeters = geo.distanceMeters;
      if (!geo.within) {
        return ok<CheckinOutOfRange>({
          success:         false,
          status:          "out_of_range",
          location_id:     data.location_id,
          work_id:         data.work_id,
          location_name:   location.name,
          message:         `チェックイン可能範囲の外にいます（距離: 約${geo.distanceMeters}m / 許容: ${location.radiusMeters}m）`,
          distance_meters: geo.distanceMeters,
          radius_meters:   location.radiusMeters,
        });
      }
    }

    // ── 3. ユーザー進行状態 ──
    const progress = await prisma.userProgress.findUnique({
      where: { lineUserId_workId: { lineUserId: data.line_user_id, workId: data.work_id } },
    });
    if (!progress) return badRequest("シナリオが開始されていません。まずシナリオを開始してください。");
    if (progress.reachedEnding) return badRequest("シナリオは既に完了しています");

    // ── 4. クールダウン ──
    const lastVisit = await prisma.locationVisit.findFirst({
      where: { lineUserId: data.line_user_id, locationId: data.location_id },
      orderBy: { visitedAt: "desc" },
    });
    if (lastVisit) {
      const elapsed = (Date.now() - lastVisit.visitedAt.getTime()) / 1000;
      if (elapsed < location.cooldownSeconds) {
        const remaining = Math.ceil(location.cooldownSeconds - elapsed);
        return ok<CheckinCooldown>({
          success: true, status: "cooldown",
          location_id: data.location_id, work_id: data.work_id,
          location_name: location.name, checkin_method: method,
          message: `あと${formatCooldown(remaining)}で再チェックインできます`,
          cooldown_remaining_seconds: remaining,
        });
      }
    }

    // ── 5. スタンプ判定（チェックイン前の状態） ──
    let stampInfo: StampInfo | undefined;
    if (location.stampEnabled) {
      const isFirstVisit = !lastVisit;
      // 先にスタンプ情報を計算（transaction 前）
      const [stampLocations, existingVisits] = await Promise.all([
        prisma.location.count({ where: { workId: data.work_id, stampEnabled: true, isActive: true } }),
        prisma.locationVisit.groupBy({
          by: ["locationId"],
          where: {
            workId: data.work_id,
            lineUserId: data.line_user_id,
            location: { stampEnabled: true, isActive: true },
          },
        }),
      ]);
      const completedBefore = existingVisits.length;
      const newlyCollected = isFirstVisit;
      const completedAfter = newlyCollected ? completedBefore + 1 : completedBefore;
      stampInfo = {
        enabled:         true,
        newly_collected: newlyCollected,
        completed_count: completedAfter,
        total_count:     stampLocations,
        is_completed:    completedAfter >= stampLocations,
      };
    }

    // ── 6. チェックイン実行 ──
    let currentFlags: Record<string, unknown> = {};
    try { currentFlags = JSON.parse(progress.flags); } catch { /* ignore */ }

    let newFlags = currentFlags;
    let newPhaseId = progress.currentPhaseId;
    let reachedEnding: boolean = progress.reachedEnding;
    let transitionPhase: { id: string; name: string; phaseType: string } | undefined;
    let flagsApplied: Record<string, unknown> | undefined;

    if (location.setFlags && location.setFlags !== "{}") {
      newFlags = applySetFlags(currentFlags, location.setFlags);
      try { flagsApplied = JSON.parse(location.setFlags); } catch { /* ignore */ }
    }

    if (location.transition) {
      const t = location.transition;
      if (t.fromPhaseId === progress.currentPhaseId && t.isActive && evaluateCondition(newFlags, t.flagCondition)) {
        newPhaseId = t.toPhaseId;
        if (t.setFlags && t.setFlags !== "{}") newFlags = applySetFlags(newFlags, t.setFlags);
        if (t.toPhase?.phaseType === "ending") reachedEnding = true;
        transitionPhase = t.toPhase ?? undefined;
      }
    }

    await prisma.$transaction([
      prisma.locationVisit.create({
        data: {
          lineUserId:     data.line_user_id,
          locationId:     data.location_id,
          workId:         data.work_id,
          checkinMethod:  method,
          distanceMeters: distanceMeters ?? null,
        },
      }),
      prisma.userProgress.update({
        where: { lineUserId_workId: { lineUserId: data.line_user_id, workId: data.work_id } },
        data: {
          currentPhaseId: newPhaseId, reachedEnding,
          flags: JSON.stringify(newFlags), lastInteractedAt: new Date(),
        },
      }),
    ]);

    // ── 7. レスポンス ──
    return ok<CheckinSuccess>({
      success: true, status: "checked_in",
      location_id: data.location_id, work_id: data.work_id,
      location_name: location.name, checkin_method: method,
      message: transitionPhase
        ? `${location.name}にチェックインしました。${transitionPhase.name}に進みます。`
        : `${location.name}にチェックインしました`,
      cooldown_remaining_seconds: 0,
      ...(distanceMeters !== undefined && { distance_meters: distanceMeters }),
      ...(location.radiusMeters != null && { radius_meters: location.radiusMeters }),
      ...(transitionPhase && { transition: { id: transitionPhase.id, name: transitionPhase.name, phase_type: transitionPhase.phaseType } }),
      ...(flagsApplied && { flags_applied: flagsApplied }),
      ...(stampInfo && { stamp: stampInfo }),
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
