// src/app/api/liff/checkin/route.ts
// POST /api/liff/checkin — LIFF ロケーションチェックイン（プレイヤー向け・認証不要）
//
// 対応方式:
//   qr_only    — QR 読み取りのみ (checkin_method: "qr")
//   gps_only   — GPS 範囲判定のみ (checkin_method: "gps")
//   qr_and_gps — QR + GPS 二段階 (checkin_method: "qr_and_gps")
//
// Location.checkinMode に基づいて判定。既存 QR/GPS チェックインとの後方互換を維持。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { checkinSchema, formatZodErrors } from "@/lib/validations";
import { applySetFlags, evaluateCondition } from "@/lib/runtime";
import { isWithinRadius } from "@/lib/geo";
import { ZodError } from "zod";
import type { CheckinSuccess, CheckinCooldown, CheckinOutOfRange, CheckinMethod, StampInfo } from "@/types";

export const dynamic = "force-dynamic";

function logAttempt(data: {
  workId: string; locationId: string; lineUserId: string;
  method: string; status: string; failureReason?: string;
  distanceMeters?: number; lat?: number; lng?: number;
}): void {
  prisma.checkinAttempt.create({
    data: {
      workId: data.workId, locationId: data.locationId, lineUserId: data.lineUserId,
      method: data.method, status: data.status, failureReason: data.failureReason ?? null,
      distanceMeters: data.distanceMeters ?? null, lat: data.lat ?? null, lng: data.lng ?? null,
    },
  }).catch(() => {});
}

/** GPS 範囲判定を実行し、結果を返す。失敗時は Response を返す。 */
function validateGps(
  data: { lat?: number; lng?: number; work_id: string; location_id: string; line_user_id: string },
  location: { latitude: number | null; longitude: number | null; radiusMeters: number | null; gpsEnabled: boolean; checkinMode: string; name: string },
  method: string,
): { ok: true; distanceMeters: number } | { ok: false; response: ReturnType<typeof ok | typeof badRequest> } {
  const attemptBase = { workId: data.work_id, locationId: data.location_id, lineUserId: data.line_user_id, method, lat: data.lat, lng: data.lng };

  const needsGps = location.checkinMode === "gps_only" || location.checkinMode === "qr_and_gps";
  if (!needsGps && !location.gpsEnabled) {
    logAttempt({ ...attemptBase, status: "location_not_supported" });
    return { ok: false, response: badRequest("この地点は GPS チェックインに対応していません") };
  }
  if (location.latitude == null || location.longitude == null || location.radiusMeters == null) {
    logAttempt({ ...attemptBase, status: "location_config_incomplete" });
    return { ok: false, response: badRequest("このロケーションの GPS 設定が不完全です（座標または半径が未設定）") };
  }
  if (data.lat == null || data.lng == null) {
    logAttempt({ ...attemptBase, status: "invalid_request", failureReason: "lat/lng missing" });
    return { ok: false, response: badRequest(
      location.checkinMode === "qr_and_gps"
        ? "このロケーションは QR + GPS の二段階チェックインが必要です。位置情報を許可してください。"
        : "GPS チェックインには緯度・経度が必要です"
    ) };
  }
  if (data.lat < -90 || data.lat > 90 || data.lng < -180 || data.lng > 180) {
    logAttempt({ ...attemptBase, status: "invalid_request", failureReason: "lat/lng out of bounds" });
    return { ok: false, response: badRequest("緯度・経度の値が不正です") };
  }

  const geo = isWithinRadius(data.lat, data.lng, location.latitude, location.longitude, location.radiusMeters);

  if (!geo.within) {
    logAttempt({ ...attemptBase, status: "out_of_range", distanceMeters: geo.distanceMeters });
    return { ok: false, response: ok<CheckinOutOfRange>({
      success: false, status: "out_of_range",
      location_id: data.location_id, work_id: data.work_id, location_name: location.name,
      message: `チェックイン可能範囲の外にいます（距離: 約${geo.distanceMeters}m / 許容: ${location.radiusMeters}m）`,
      distance_meters: geo.distanceMeters, radius_meters: location.radiusMeters,
    }) };
  }

  return { ok: true, distanceMeters: geo.distanceMeters };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = checkinSchema.parse(body);
    const clientMethod: CheckinMethod = data.checkin_method ?? "qr";

    // ── 1. ロケーション取得 ──
    const location = await prisma.location.findUnique({
      where: { id: data.location_id },
      include: { transition: { include: { toPhase: { select: { id: true, name: true, phaseType: true } } } } },
    });
    if (!location) return notFound("ロケーション");
    if (!location.isActive) return badRequest("このロケーションは現在無効です");
    if (location.workId !== data.work_id) return badRequest("ロケーションが指定作品に属していません");

    const mode = location.checkinMode as string; // "qr_only" | "gps_only" | "qr_and_gps"

    // ── 2. 方式別判定 ──
    let distanceMeters: number | undefined;
    let recordedMethod: CheckinMethod;

    if (mode === "qr_only") {
      // QR のみ — GPS 不要、そのまま成功
      recordedMethod = "qr";

    } else if (mode === "gps_only") {
      // GPS のみ
      if (clientMethod !== "gps") {
        return badRequest("このロケーションは GPS チェックインのみ対応しています。「現在地でチェックイン」をご利用ください。");
      }
      const gpsResult = validateGps(data, location, "gps");
      if (!gpsResult.ok) return gpsResult.response;
      distanceMeters = gpsResult.distanceMeters;
      recordedMethod = "gps";

    } else if (mode === "qr_and_gps") {
      // 二段階: QR で location 確定 + GPS 範囲判定
      // クライアントは checkin_method: "qr_and_gps" で lat/lng を送る
      const gpsResult = validateGps(data, location, "qr_and_gps");
      if (!gpsResult.ok) return gpsResult.response;
      distanceMeters = gpsResult.distanceMeters;
      recordedMethod = "qr_and_gps";

    } else {
      // 未知の mode — 後方互換: QR として扱う
      recordedMethod = "qr";
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
          location_name: location.name, checkin_method: recordedMethod,
          message: `あと${formatCooldown(remaining)}で再チェックインできます`,
          cooldown_remaining_seconds: remaining,
        });
      }
    }

    // ── 5. スタンプ判定 ──
    let stampInfo: StampInfo | undefined;
    if (location.stampEnabled) {
      const isFirstVisit = !lastVisit;
      const [stampCount, visited] = await Promise.all([
        prisma.location.count({ where: { workId: data.work_id, stampEnabled: true, isActive: true } }),
        prisma.locationVisit.groupBy({ by: ["locationId"], where: { workId: data.work_id, lineUserId: data.line_user_id, location: { stampEnabled: true, isActive: true } } }),
      ]);
      const before = visited.length;
      const after = isFirstVisit ? before + 1 : before;
      stampInfo = { enabled: true, newly_collected: isFirstVisit, completed_count: after, total_count: stampCount, is_completed: after >= stampCount };
    }

    // ── 6. Transition / Flags ──
    let currentFlags: Record<string, unknown> = {};
    try { currentFlags = JSON.parse(progress.flags); } catch {}

    let newFlags = currentFlags;
    let newPhaseId = progress.currentPhaseId;
    let reachedEnding: boolean = progress.reachedEnding;
    let transitionPhase: { id: string; name: string; phaseType: string } | undefined;
    let flagsApplied: Record<string, unknown> | undefined;

    if (location.setFlags && location.setFlags !== "{}") {
      newFlags = applySetFlags(currentFlags, location.setFlags);
      try { flagsApplied = JSON.parse(location.setFlags); } catch {}
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

    // ── 7. DB 書き込み ──
    await prisma.$transaction([
      prisma.locationVisit.create({
        data: { lineUserId: data.line_user_id, locationId: data.location_id, workId: data.work_id, checkinMethod: recordedMethod, distanceMeters: distanceMeters ?? null },
      }),
      prisma.userProgress.update({
        where: { lineUserId_workId: { lineUserId: data.line_user_id, workId: data.work_id } },
        data: { currentPhaseId: newPhaseId, reachedEnding, flags: JSON.stringify(newFlags), lastInteractedAt: new Date() },
      }),
    ]);

    // GPS 成功ログ
    if (recordedMethod === "gps" || recordedMethod === "qr_and_gps") {
      logAttempt({ workId: data.work_id, locationId: data.location_id, lineUserId: data.line_user_id, method: recordedMethod, status: "success", distanceMeters, lat: data.lat, lng: data.lng });
    }

    // ── 8. レスポンス ──
    return ok<CheckinSuccess>({
      success: true, status: "checked_in",
      location_id: data.location_id, work_id: data.work_id,
      location_name: location.name, checkin_method: recordedMethod,
      message: transitionPhase ? `${location.name}にチェックインしました。${transitionPhase.name}に進みます。` : `${location.name}にチェックインしました`,
      cooldown_remaining_seconds: 0,
      ...(distanceMeters !== undefined && { distance_meters: distanceMeters }),
      ...(location.radiusMeters != null && recordedMethod !== "qr" && { radius_meters: location.radiusMeters }),
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
  return `約${Math.ceil(seconds / 60)}分`;
}
