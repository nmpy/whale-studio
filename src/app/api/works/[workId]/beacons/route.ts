// src/app/api/works/[workId]/beacons/route.ts
// GET  /api/works/[workId]/beacons — beacon trigger 一覧（作品スコープ + OA 共通）
// POST /api/works/[workId]/beacons — beacon trigger 作成

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ok, created, badRequest, notFound, conflict, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { createBeaconTriggerSchema, formatZodErrors } from "@/lib/validations";
import { normalizeBeaconHwid, InvalidBeaconHwidError } from "@/lib/beacon-hwid";
import { ZodError } from "zod";
import { toBeaconTriggerResponse } from "@/lib/beacon-utils";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ workId: string }>(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const triggers = await prisma.beaconTrigger.findMany({
      where: {
        oaId,
        OR: [{ workId }, { workId: null }],
      },
      orderBy: [{ createdAt: "asc" }],
    });

    // 各 trigger の最終検知ログをまとめて取得（N+1 を避ける）
    const triggerIds = triggers.map((t) => t.id);
    const lastLogs = triggerIds.length > 0
      ? await prisma.beaconEventLog.findMany({
          where: { beaconTriggerId: { in: triggerIds } },
          orderBy: { createdAt: "desc" },
          distinct: ["beaconTriggerId"],
          select: { beaconTriggerId: true, createdAt: true, actionStatus: true },
        })
      : [];
    const lastByTrigger = new Map(
      lastLogs.map((l) => [l.beaconTriggerId, l]),
    );

    return ok(triggers.map((t) => toBeaconTriggerResponse(t, lastByTrigger.get(t.id) ?? null)));
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withAuth<{ workId: string }>(async (req, ctx, user) => {
  try {
    const { workId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = createBeaconTriggerSchema.parse(body);

    let hwid: string;
    try {
      hwid = normalizeBeaconHwid(data.hwid);
    } catch (e) {
      const msg = e instanceof InvalidBeaconHwidError ? e.message : "HWID が不正です";
      return badRequest(msg, { hwid: [msg] });
    }

    // 同一 OA 内で HWID 重複は不可（@@unique([oaId, hwid])）
    const existing = await prisma.beaconTrigger.findUnique({
      where: { oaId_hwid: { oaId, hwid } },
    });
    if (existing) {
      return conflict(`HWID "${hwid}" はこの OA で既に登録されています`);
    }

    // workId が指定された場合、その work が同 OA 配下か検証
    const targetWorkId = data.work_id ?? workId;
    if (targetWorkId) {
      const w = await prisma.work.findUnique({
        where: { id: targetWorkId },
        select: { oaId: true },
      });
      if (!w || w.oaId !== oaId) {
        return badRequest("指定された work_id がこの OA に属していません");
      }
    }

    const trigger = await prisma.beaconTrigger.create({
      data: {
        oaId,
        workId:          targetWorkId,
        name:            data.name,
        hwid,
        enabled:         data.enabled ?? true,
        eventTypes:      data.event_types ?? "enter",
        cooldownSeconds: data.cooldown_seconds ?? 300,
        actionType:      data.action_type,
        actionPayload:   data.action_payload == null
          ? Prisma.JsonNull
          : (data.action_payload as Prisma.InputJsonValue),
      },
    });

    return created(toBeaconTriggerResponse(trigger, null));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    }
    return serverError(err);
  }
});
