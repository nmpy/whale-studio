// src/app/api/phases/[id]/route.ts
// GET    /api/phases/:id — フェーズ詳細（メッセージ・遷移数を含む）
// PATCH  /api/phases/:id — フェーズ更新
// DELETE /api/phases/:id — フェーズ削除
//
// 整合性ルール（PATCH）:
//   - phaseType を "start" に変更する場合、同一作品に start フェーズが存在してはならない
//   - phaseType を "ending" に変更する場合、発信側の Transition を自動削除する
//     （エンディングから先へ遷移する概念は存在しないため）
//
// 整合性ルール（DELETE）:
//   - messages.phase_id    → SET NULL（Prisma onDelete: SetNull）
//   - transitions（from/to）→ CASCADE 削除（Prisma onDelete: Cascade）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { updatePhaseSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

function toResponse(p: {
  id: string; workId: string; phaseType: string; name: string; description: string | null;
  startTrigger: string | null;
  sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date;
  _count?: { messages: number; transitionsFrom: number };
}) {
  return {
    id:            p.id,
    work_id:       p.workId,
    phase_type:    p.phaseType,
    name:          p.name,
    description:   p.description,
    start_trigger: p.startTrigger,
    sort_order:    p.sortOrder,
    is_active:     p.isActive,
    created_at:    p.createdAt,
    updated_at:    p.updatedAt,
    ...(p._count !== undefined && { _count: p._count }),
  };
}

// ── GET /api/phases/:id ──────────────────────────
export const GET = withAuth<{ id: string }>(async (_req, { params }, user) => {
  try {
    const phase = await prisma.phase.findUnique({
      where: { id: params.id },
      include: {
        _count: { select: { messages: true, transitionsFrom: true } },
        work: { select: { oaId: true } },
      },
    });
    if (!phase) return notFound("フェーズ");

    const check = await requireRole(phase.work.oaId, user.id, 'viewer');
    if (!check.ok) return check.response;

    return ok(toResponse(phase));
  } catch (err) {
    return serverError(err);
  }
});

// ── PATCH /api/phases/:id ────────────────────────
export const PATCH = withAuth<{ id: string }>(async (req, { params }, user) => {
  try {
    const existing = await prisma.phase.findUnique({
      where: { id: params.id },
      include: { work: { select: { oaId: true } } },
    });
    if (!existing) return notFound("フェーズ");

    const check = await requireRole(existing.work.oaId, user.id, 'editor');
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = updatePhaseSchema.parse(body);

    // ─ 整合性チェック: start への変更は1作品1件まで ─
    if (data.phase_type === "start" && existing.phaseType !== "start") {
      const existingStart = await prisma.phase.findFirst({
        where: {
          workId:    existing.workId,
          phaseType: "start",
          id:        { not: params.id },
        },
        select: { id: true, name: true },
      });
      if (existingStart) {
        return badRequest(
          `開始フェーズは1作品につき1件のみ設定できます（既存: 「${existingStart.name}」）`
        );
      }
    }

    // ─ 整合性処理: ending への変更時、発信 Transition を自動削除 ─
    if (data.phase_type === "ending" && existing.phaseType !== "ending") {
      await prisma.transition.deleteMany({
        where: { fromPhaseId: params.id },
      });
    }

    const updated = await prisma.phase.update({
      where: { id: params.id },
      data: {
        ...(data.phase_type    !== undefined && { phaseType:    data.phase_type }),
        ...(data.name          !== undefined && { name:         data.name }),
        ...(data.description   !== undefined && { description:  data.description }),
        ...(data.start_trigger !== undefined && { startTrigger: data.start_trigger }),
        ...(data.sort_order    !== undefined && { sortOrder:    data.sort_order }),
        ...(data.is_active     !== undefined && { isActive:     data.is_active }),
      },
      include: { _count: { select: { messages: true, transitionsFrom: true } } },
    });

    return ok(toResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── DELETE /api/phases/:id ───────────────────────
export const DELETE = withAuth<{ id: string }>(async (_req, { params }, user) => {
  try {
    const existing = await prisma.phase.findUnique({
      where: { id: params.id },
      include: {
        _count: { select: { messages: true, transitionsFrom: true } },
        work: { select: { oaId: true } },
      },
    });
    if (!existing) return notFound("フェーズ");

    const check = await requireRole(existing.work.oaId, user.id, 'owner');
    if (!check.ok) return check.response;

    // Prisma onDelete 動作（schema.prisma 定義に従い自動処理）:
    //   Message.phase_id    → SET NULL（メッセージは残り、フェーズ紐付けが外れる）
    //   Transition.fromPhaseId / toPhaseId → CASCADE（このフェーズを参照する遷移をすべて削除）
    await prisma.phase.delete({ where: { id: params.id } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
