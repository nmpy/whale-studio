// src/app/api/works/[workId]/route.ts
// GET    /api/works/:workId — 作品詳細（_count 付き）
// PATCH  /api/works/:workId — 作品更新
// DELETE /api/works/:workId — 作品削除（CASCADE: characters/phases/messages も削除）

import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { updateWorkSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import { activeCache, CACHE_KEY } from "@/lib/cache";

function toResponse(w: {
  id: string; oaId: string; title: string; description: string | null;
  publishStatus: string; sortOrder: number; systemCharacterId: string | null;
  welcomeMessage: string | null;
  readReceiptMode: string | null; readDelayMs: number | null;
  typingEnabled: boolean | null; typingMinMs: number | null; typingMaxMs: number | null;
  loadingEnabled: boolean | null; loadingThresholdMs: number | null;
  loadingMinSeconds: number | null; loadingMaxSeconds: number | null;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id:                  w.id,
    oa_id:               w.oaId,
    title:               w.title,
    description:         w.description,
    publish_status:      w.publishStatus,
    sort_order:          w.sortOrder,
    system_character_id: w.systemCharacterId,
    welcome_message:     w.welcomeMessage,
    // 演出設定
    read_receipt_mode:    (w.readReceiptMode as import("@/types").ReadReceiptMode) ?? null,
    read_delay_ms:        w.readDelayMs ?? null,
    typing_enabled:       w.typingEnabled ?? null,
    typing_min_ms:        w.typingMinMs ?? null,
    typing_max_ms:        w.typingMaxMs ?? null,
    loading_enabled:      w.loadingEnabled ?? null,
    loading_threshold_ms: w.loadingThresholdMs ?? null,
    loading_min_seconds:  w.loadingMinSeconds ?? null,
    loading_max_seconds:  w.loadingMaxSeconds ?? null,
    created_at:          w.createdAt,
    updated_at:          w.updatedAt,
  };
}

// ── GET /api/works/:workId ───────────────────────────
export const GET = withAuth<{ workId: string }>(async (_req, { params }, user) => {
  try {
    const work = await prisma.work.findUnique({
      where: { id: params.workId },
      include: {
        _count: {
          select: { characters: true, phases: true, messages: true, userProgress: true },
        },
      },
    });
    if (!work) return notFound("作品");

    const check = await requireRole(work.oaId, user.id, 'viewer');
    if (!check.ok) return check.response;

    return ok({ ...toResponse(work), _count: work._count });
  } catch (err) {
    return serverError(err);
  }
});

// ── PATCH /api/works/:workId ─────────────────────────
export const PATCH = withAuth<{ workId: string }>(async (req, { params }, user) => {
  try {
    const existing = await prisma.work.findUnique({ where: { id: params.workId } });
    if (!existing) return notFound("作品");

    const check = await requireRole(existing.oaId, user.id, 'tester');
    if (!check.ok) return check.response;

    const body = await req.json();
    const data = updateWorkSchema.parse(body);

    const updated = await prisma.work.update({
      where: { id: params.workId },
      data: {
        ...(data.title               !== undefined && { title:              data.title }),
        ...(data.description         !== undefined && { description:        data.description }),
        ...(data.publish_status      !== undefined && { publishStatus:      data.publish_status }),
        ...(data.sort_order          !== undefined && { sortOrder:          data.sort_order }),
        ...(data.system_character_id !== undefined && { systemCharacterId:  data.system_character_id }),
        ...(data.welcome_message     !== undefined && { welcomeMessage:     data.welcome_message }),
        // 演出設定
        ...(data.read_receipt_mode    !== undefined && { readReceiptMode:    data.read_receipt_mode }),
        ...(data.read_delay_ms        !== undefined && { readDelayMs:        data.read_delay_ms }),
        ...(data.typing_enabled       !== undefined && { typingEnabled:      data.typing_enabled }),
        ...(data.typing_min_ms        !== undefined && { typingMinMs:        data.typing_min_ms }),
        ...(data.typing_max_ms        !== undefined && { typingMaxMs:        data.typing_max_ms }),
        ...(data.loading_enabled      !== undefined && { loadingEnabled:     data.loading_enabled }),
        ...(data.loading_threshold_ms !== undefined && { loadingThresholdMs: data.loading_threshold_ms }),
        ...(data.loading_min_seconds  !== undefined && { loadingMinSeconds:  data.loading_min_seconds }),
        ...(data.loading_max_seconds  !== undefined && { loadingMaxSeconds:  data.loading_max_seconds }),
      },
    });

    // キャッシュ無効化
    await activeCache.delete(CACHE_KEY.work(existing.oaId));

    return ok(toResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── DELETE /api/works/:workId ────────────────────────
export const DELETE = withAuth<{ workId: string }>(async (_req, { params }, user) => {
  try {
    const existing = await prisma.work.findUnique({ where: { id: params.workId } });
    if (!existing) return notFound("作品");

    const check = await requireRole(existing.oaId, user.id, 'owner');
    if (!check.ok) return check.response;

    // CASCADE により characters / phases / messages も削除される
    await prisma.work.delete({ where: { id: params.workId } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
