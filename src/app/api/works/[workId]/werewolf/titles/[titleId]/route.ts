// src/app/api/works/[workId]/werewolf/titles/[titleId]/route.ts
//
// 人狼タイトル詳細 (GM 用 / CMS 認証必要)
//   GET    — タイトル詳細 (slots + 各 slot の cards 含む)
//   PUT    — タイトル本体更新 (title / description / scheduledAt / playerCount)
//            playerCount を増減すると WerewolfRoleSlot を auto extend / 末尾削除する
//   DELETE — タイトル削除 (cascade で slot / card も消える)

import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { updateWerewolfTitleSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

function serializeTitle(t: {
  id: string; publicId: string;
  liffPageConfigId: string; workId: string;
  title: string; description: string | null;
  scheduledAt: Date | null;
  playerCount: number;
  isStarted: boolean; startedAt: Date | null;
  sortOrder: number;
  createdAt: Date; updatedAt: Date;
  slots?: Array<{
    id: string; titleId: string; slotNumber: number;
    label: string | null; token: string;
    createdAt: Date; updatedAt: Date;
    cards?: Array<{
      id: string; slotId: string;
      title: string; subtitle: string | null; badgeLabel: string | null;
      body: string; sortOrder: number;
      createdAt: Date; updatedAt: Date;
    }>;
  }>;
}) {
  return {
    id:                  t.id,
    public_id:           t.publicId,
    liff_page_config_id: t.liffPageConfigId,
    work_id:             t.workId,
    title:               t.title,
    description:         t.description,
    scheduled_at:        t.scheduledAt,
    player_count:        t.playerCount,
    is_started:          t.isStarted,
    started_at:          t.startedAt,
    sort_order:          t.sortOrder,
    created_at:          t.createdAt,
    updated_at:          t.updatedAt,
    ...(t.slots && {
      slots: t.slots.map((s) => ({
        id:           s.id,
        title_id:     s.titleId,
        slot_number:  s.slotNumber,
        label:        s.label,
        token:        s.token,
        created_at:   s.createdAt,
        updated_at:   s.updatedAt,
        ...(s.cards && {
          cards: s.cards.map((c) => ({
            id:          c.id,
            slot_id:     c.slotId,
            title:       c.title,
            subtitle:    c.subtitle,
            badge_label: c.badgeLabel,
            body:        c.body,
            sort_order:  c.sortOrder,
            created_at:  c.createdAt,
            updated_at:  c.updatedAt,
          })),
        }),
      })),
    }),
  };
}

// ── GET /api/works/[workId]/werewolf/titles/[titleId] ───────────────────
// 詳細 + slots + cards をまとめて返す。GM 編集画面で 1 リクエストで全部受け取る。
export const GET = withAuth(async (_req, ctx, user) => {
  try {
    const { workId, titleId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const title = await prisma.werewolfTitle.findUnique({
      where: { id: titleId },
      include: {
        slots: {
          orderBy: { slotNumber: "asc" },
          include: {
            cards: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
          },
        },
      },
    });

    if (!title || title.workId !== workId) return notFound("WerewolfTitle");
    return ok(serializeTitle(title));
  } catch (err) {
    return serverError(err);
  }
});

// ── PUT /api/works/[workId]/werewolf/titles/[titleId] ───────────────────
// タイトル本体の更新 + playerCount 増減に応じて slot を auto extend / 末尾削除。
// is_started=true の場合は player_count 変更を拒否する (ゲーム中は構成変更させない)。
export const PUT = withAuth(async (req, ctx, user) => {
  try {
    const { workId, titleId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const existing = await prisma.werewolfTitle.findUnique({
      where: { id: titleId },
      select: { id: true, workId: true, playerCount: true, isStarted: true },
    });
    if (!existing || existing.workId !== workId) return notFound("WerewolfTitle");

    const body = await req.json();
    const data = updateWerewolfTitleSchema.parse(body);

    // ゲーム開始済みのときは playerCount を変更させない (slot 構成の変更を防ぐ)。
    if (existing.isStarted && data.player_count !== undefined && data.player_count !== existing.playerCount) {
      return badRequest("ゲーム開始後はプレイヤー人数を変更できません。リセットしてから操作してください。");
    }

    // playerCount 変更があれば slot を増減
    if (data.player_count !== undefined && data.player_count !== existing.playerCount) {
      await prisma.$transaction(async (tx) => {
        const diff = data.player_count! - existing.playerCount;
        if (diff > 0) {
          // 増: 末尾に追加。slot_number は連番で。
          await tx.werewolfRoleSlot.createMany({
            data: Array.from({ length: diff }, (_, i) => ({
              titleId,
              slotNumber: existing.playerCount + i + 1,
              label:      `プレイヤー${existing.playerCount + i + 1}`,
            })),
          });
        } else {
          // 減: 末尾を削除。slot_number > 新 player_count を CASCADE で削除。
          await tx.werewolfRoleSlot.deleteMany({
            where: { titleId, slotNumber: { gt: data.player_count! } },
          });
        }
      });
    }

    const updated = await prisma.werewolfTitle.update({
      where: { id: titleId },
      data: {
        ...(data.title        !== undefined && { title:        data.title }),
        ...(data.description  !== undefined && { description:  data.description }),
        ...(data.scheduled_at !== undefined && { scheduledAt:  data.scheduled_at ? new Date(data.scheduled_at) : null }),
        ...(data.player_count !== undefined && { playerCount:  data.player_count }),
      },
      include: {
        slots: {
          orderBy: { slotNumber: "asc" },
          include: { cards: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
        },
      },
    });

    return ok(serializeTitle(updated));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力内容に誤りがあります", formatZodErrors(err));
    return serverError(err);
  }
});

// ── DELETE /api/works/[workId]/werewolf/titles/[titleId] ────────────────
// 関連する slot / card は ON DELETE CASCADE で自動的に消える。
export const DELETE = withAuth(async (_req, ctx, user) => {
  try {
    const { workId, titleId } = await ctx.params;
    const oaId = await getOaIdFromWorkId(workId);
    if (!oaId) return notFound("Work");

    const check = await requireRole(oaId, user.id, "editor");
    if (!check.ok) return check.response;

    const existing = await prisma.werewolfTitle.findUnique({
      where: { id: titleId },
      select: { id: true, workId: true },
    });
    if (!existing || existing.workId !== workId) return notFound("WerewolfTitle");

    await prisma.werewolfTitle.delete({ where: { id: titleId } });

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
