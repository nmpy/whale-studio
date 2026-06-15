// src/app/api/oas/[id]/beacons/[beaconId]/route.ts
// PATCH  /api/oas/[id]/beacons/[beaconId] — beacon trigger 更新
// DELETE /api/oas/[id]/beacons/[beaconId] — beacon trigger 削除
//
// OA レベル管理画面用。後方互換の /api/works/[workId]/beacons/[beaconId] は残す。

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ok, badRequest, notFound, noContent, conflict, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { requirePlanFeature } from "@/lib/plan-guard";
import { FEATURE } from "@/lib/constants/plans";
import { updateBeaconTriggerSchema, formatZodErrors } from "@/lib/validations";
import { normalizeBeaconHwid, InvalidBeaconHwidError } from "@/lib/beacon-hwid";
import { toBeaconTriggerResponse } from "@/lib/beacon-utils";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

export const PATCH = withAuth<{ id: string; beaconId: string }>(async (req, ctx, user) => {
  try {
    const { id: oaId, beaconId } = await ctx.params;

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const gate = await requirePlanFeature({ oaId, featureKey: FEATURE.location });
    if (!gate.ok) return gate.response;

    const existing = await prisma.beaconTrigger.findUnique({ where: { id: beaconId } });
    if (!existing || existing.oaId !== oaId) return notFound("BeaconTrigger");

    const body = await req.json();
    const data = updateBeaconTriggerSchema.parse(body);

    // action_type="message" の場合、messageId は対象作品（or OA）のメッセージのみ許可。
    const effectiveActionType = data.action_type ?? existing.actionType;
    if (effectiveActionType === "message" && data.action_payload !== undefined && data.action_payload !== null) {
      const messageId = (data.action_payload as Record<string, unknown>)?.message_id;
      if (typeof messageId === "string" && messageId) {
        const effectiveWorkId = data.work_id !== undefined ? data.work_id : existing.workId;
        const m = await prisma.message.findUnique({
          where: { id: messageId },
          select: { workId: true, work: { select: { oaId: true } } },
        });
        if (!m) return badRequest("指定されたメッセージが見つかりません", { action_payload: ["message が不正です"] });
        if (effectiveWorkId && m.workId !== effectiveWorkId) {
          return badRequest("指定されたメッセージがこの作品に属していません", { action_payload: ["message が不正です"] });
        }
        if (!effectiveWorkId && m.work.oaId !== oaId) {
          return badRequest("指定されたメッセージがこの OA に属していません", { action_payload: ["message が不正です"] });
        }
      }
    }

    let nextHwid = existing.hwid;
    if (data.hwid !== undefined) {
      try {
        nextHwid = normalizeBeaconHwid(data.hwid);
      } catch (e) {
        const msg = e instanceof InvalidBeaconHwidError ? e.message : "HWID が不正です";
        return badRequest(msg, { hwid: [msg] });
      }
      if (nextHwid !== existing.hwid) {
        const dup = await prisma.beaconTrigger.findUnique({ where: { oaId_hwid: { oaId, hwid: nextHwid } } });
        if (dup) return conflict(`HWID "${nextHwid}" はこの OA で既に登録されています`);
      }
    }

    if (data.work_id !== undefined && data.work_id !== null) {
      const w = await prisma.work.findUnique({ where: { id: data.work_id }, select: { oaId: true } });
      if (!w || w.oaId !== oaId) {
        return badRequest("指定された work_id がこの OA に属していません");
      }
    }

    // location_id が指定された場合、地点の存在 + 同 OA を検証（null = 紐づけ解除）。
    if (data.location_id !== undefined && data.location_id !== null) {
      const loc = await prisma.location.findUnique({ where: { id: data.location_id }, select: { work: { select: { oaId: true } } } });
      if (!loc || loc.work.oaId !== oaId) {
        return badRequest("指定された地点がこの OA に属していません", { location_id: ["地点が不正です"] });
      }
    }

    const updated = await prisma.beaconTrigger.update({
      where: { id: beaconId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.hwid !== undefined && { hwid: nextHwid }),
        ...(data.work_id !== undefined && { workId: data.work_id }),
        ...(data.location_id !== undefined && { locationId: data.location_id }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
        ...(data.event_types !== undefined && { eventTypes: data.event_types }),
        ...(data.cooldown_seconds !== undefined && { cooldownSeconds: data.cooldown_seconds }),
        ...(data.once_per_user !== undefined && { oncePerUser: data.once_per_user }),
        ...(data.max_triggers_per_user !== undefined && { maxTriggersPerUser: data.max_triggers_per_user }),
        ...(data.valid_from !== undefined && { validFrom: data.valid_from }),
        ...(data.valid_to !== undefined && { validTo: data.valid_to }),
        ...(data.note !== undefined && { note: data.note }),
        ...(data.action_type !== undefined && { actionType: data.action_type }),
        ...(data.action_payload !== undefined && {
          actionPayload:
            data.action_payload === null
              ? Prisma.JsonNull
              : (data.action_payload as Prisma.InputJsonValue),
        }),
      },
    });

    return ok(toBeaconTriggerResponse(updated, null));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});

export const DELETE = withAuth<{ id: string; beaconId: string }>(async (_req, ctx, user) => {
  try {
    const { id: oaId, beaconId } = await ctx.params;

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const gate = await requirePlanFeature({ oaId, featureKey: FEATURE.location });
    if (!gate.ok) return gate.response;

    const existing = await prisma.beaconTrigger.findUnique({ where: { id: beaconId } });
    if (!existing || existing.oaId !== oaId) return notFound("BeaconTrigger");

    await prisma.beaconTrigger.delete({ where: { id: beaconId } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
