// src/app/api/oas/[id]/beacons/route.ts
// GET  /api/oas/[id]/beacons — OA 配下の beacon trigger 一覧（OA 共通 + 全作品）
// POST /api/oas/[id]/beacons — beacon trigger 作成（work_id 任意 = OA 共通 / 作品別）
//
// canonical な OA レベル管理画面（/oas/[id]/locations/beacons）用。
// 既存の作品スコープ API（/api/works/[workId]/beacons）は後方互換のため残す。

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ok, created, badRequest, notFound, conflict, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { requirePlanFeature } from "@/lib/plan-guard";
import { FEATURE } from "@/lib/constants/plans";
import { createBeaconTriggerSchema, formatZodErrors } from "@/lib/validations";
import { normalizeBeaconHwid, InvalidBeaconHwidError } from "@/lib/beacon-hwid";
import { ZodError } from "zod";
import { toBeaconTriggerResponse } from "@/lib/beacon-utils";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(async (_req, ctx, user) => {
  try {
    const { id: oaId } = await ctx.params;

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const triggers = await prisma.beaconTrigger.findMany({
      where: { oaId },
      orderBy: [{ createdAt: "asc" }],
    });

    // 直近検知ログ（N+1 回避）
    const triggerIds = triggers.map((t) => t.id);
    const lastLogs = triggerIds.length > 0
      ? await prisma.beaconEventLog.findMany({
          where: { beaconTriggerId: { in: triggerIds } },
          orderBy: { createdAt: "desc" },
          distinct: ["beaconTriggerId"],
          select: { beaconTriggerId: true, createdAt: true, actionStatus: true },
        })
      : [];
    const lastByTrigger = new Map(lastLogs.map((l) => [l.beaconTriggerId, l]));

    // 作品名（work_id 付きトリガー表示用）
    const workIds = [...new Set(triggers.map((t) => t.workId).filter((v): v is string => !!v))];
    const works = workIds.length > 0
      ? await prisma.work.findMany({ where: { id: { in: workIds } }, select: { id: true, title: true } })
      : [];
    const titleByWork = new Map(works.map((w) => [w.id, w.title]));

    return ok(
      triggers.map((t) =>
        toBeaconTriggerResponse(t, lastByTrigger.get(t.id) ?? null, {
          workTitle: t.workId ? titleByWork.get(t.workId) ?? null : null,
        }),
      ),
    );
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withAuth<{ id: string }>(async (req, ctx, user) => {
  try {
    const { id: oaId } = await ctx.params;

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    // Beacon 連動は Pro 相当（FEATURE.location）。直 API でも必ずガードする。
    const gate = await requirePlanFeature({ oaId, featureKey: FEATURE.location });
    if (!gate.ok) return gate.response;

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
    const existing = await prisma.beaconTrigger.findUnique({ where: { oaId_hwid: { oaId, hwid } } });
    if (existing) {
      return conflict(`HWID "${hwid}" はこの OA で既に登録されています`);
    }

    // work_id 任意。指定時は同 OA 配下か検証。未指定なら OA 共通トリガー（workId=null）。
    const targetWorkId = data.work_id ?? null;
    if (targetWorkId) {
      const w = await prisma.work.findUnique({ where: { id: targetWorkId }, select: { oaId: true } });
      if (!w || w.oaId !== oaId) {
        return badRequest("指定された work_id がこの OA に属していません");
      }
    }

    // action_type="message" の場合、messageId は対象作品のメッセージのみ許可（OA 共通なら作品縛りなし）。
    if (data.action_type === "message") {
      const messageId = (data.action_payload as Record<string, unknown> | null | undefined)?.message_id;
      if (typeof messageId === "string" && messageId) {
        const m = await prisma.message.findUnique({
          where: { id: messageId },
          select: { workId: true, work: { select: { oaId: true } } },
        });
        if (!m) return badRequest("指定されたメッセージが見つかりません", { action_payload: ["message が不正です"] });
        if (targetWorkId && m.workId !== targetWorkId) {
          return badRequest("指定されたメッセージがこの作品に属していません", { action_payload: ["message が不正です"] });
        }
        if (!targetWorkId && m.work.oaId !== oaId) {
          return badRequest("指定されたメッセージがこの OA に属していません", { action_payload: ["message が不正です"] });
        }
      }
    }

    // location_id が指定された場合、地点の存在 +（work 指定時は）その work 配下を検証。
    if (data.location_id) {
      const loc = await prisma.location.findUnique({ where: { id: data.location_id }, select: { workId: true, work: { select: { oaId: true } } } });
      if (!loc || loc.work.oaId !== oaId) {
        return badRequest("指定された地点がこの OA に属していません", { location_id: ["地点が不正です"] });
      }
      if (targetWorkId && loc.workId !== targetWorkId) {
        return badRequest("指定された地点がこの作品に属していません", { location_id: ["地点が不正です"] });
      }
    }

    const trigger = await prisma.beaconTrigger.create({
      data: {
        oaId,
        workId:          targetWorkId,
        locationId:      data.location_id ?? null,
        name:            data.name,
        hwid,
        enabled:         data.enabled ?? true,
        eventTypes:      data.event_types ?? "enter",
        cooldownSeconds: data.cooldown_seconds ?? 300,
        oncePerUser:     data.once_per_user ?? false,
        maxTriggersPerUser: data.max_triggers_per_user ?? null,
        validFrom:       data.valid_from ?? null,
        validTo:         data.valid_to ?? null,
        note:            data.note ?? null,
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
