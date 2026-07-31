// GET  /api/works/[workId]/ticket-link-settings … 現在のチケット連携設定 + 公開されない理由
// PUT  /api/works/[workId]/ticket-link-settings … チケット連携設定のみを更新
//
//   Work.liffHomeSettingsJson の `ticket_link` キーだけを差し替える。
//   survey 等の既存フィールドや未知フィールドはサーバー側でマージして保持する
//   （クライアントから設定 JSON 全体を受け取って上書きしない）。

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import {
  readTicketLinkSettings,
  mergeTicketLinkSettings,
  validateTicketLinkSettingsPatch,
  manualInputBlockReason,
  MAX_PARTICIPANT_COUNT,
  MAX_TICKET_TYPES,
} from "@/lib/ticket-link/settings";

export const dynamic = "force-dynamic";

const ticketTypeSchema = z.object({
  ticketTypeKey:    z.string().min(1).max(100),
  ticketTypeLabel:  z.string().min(1).max(200),
  participantCount: z.number().int().min(1).max(MAX_PARTICIPANT_COUNT),
  enabled:          z.boolean(),
  sortOrder:        z.number().int().min(0).max(9999),
});

const bodySchema = z.object({
  enabled:             z.boolean().optional(),
  manualInputEnabled:  z.boolean().optional(),
  ticketTypes:         z.array(ticketTypeSchema).max(MAX_TICKET_TYPES).optional(),
  reportButtonEnabled: z.boolean().optional(),
  reportButtonLabel:   z.string().max(100).optional(),
  reportMessage:       z.string().max(500).optional(),
  completionMessage:   z.string().max(1000).optional(),
});

export const GET = withAuth<{ workId: string }>(async (_req, { params }, user) => {
  try {
    const { workId } = await params;
    const work = await prisma.work.findUnique({
      where: { id: workId },
      select: { id: true, oaId: true, liffHomeSettingsJson: true },
    });
    if (!work) return notFound("作品");

    const check = await requireRole(work.oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const settings = readTicketLinkSettings(work.liffHomeSettingsJson);
    return ok({
      settings,
      // 管理画面に「なぜ公開されないか」を出すための理由（null = 公開される）。
      blockReason: manualInputBlockReason(settings),
    });
  } catch (err) {
    console.error("[ticket-link-settings:GET] error", err);
    return serverError(err);
  }
});

export const PUT = withAuth<{ workId: string }>(async (req, { params }, user) => {
  try {
    const { workId } = await params;
    const work = await prisma.work.findUnique({
      where: { id: workId },
      select: { id: true, oaId: true, liffHomeSettingsJson: true },
    });
    if (!work) return notFound("作品");

    const check = await requireRole(work.oaId, user.id, "tester");
    if (!check.ok) return check.response;

    const patch = bodySchema.parse(await req.json());

    // サーバー側バリデーション（キー重複・空・人数上限）。クライアント検証に依存しない。
    const errors = validateTicketLinkSettingsPatch(patch);
    if (errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "設定内容が正しくありません",
            details: errors.reduce<Record<string, string[]>>((acc, e) => {
              (acc[e.field] ??= []).push(e.message);
              return acc;
            }, {}),
          },
        },
        { status: 400 },
      );
    }

    const merged = mergeTicketLinkSettings(work.liffHomeSettingsJson, patch);
    await prisma.work.update({
      where: { id: work.id },
      data: { liffHomeSettingsJson: merged as Prisma.InputJsonValue },
    });

    const settings = readTicketLinkSettings(merged);
    return ok({ settings, blockReason: manualInputBlockReason(settings) });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("設定内容が正しくありません");
    console.error("[ticket-link-settings:PUT] error", err);
    return serverError(err);
  }
});
