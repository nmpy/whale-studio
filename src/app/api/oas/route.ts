// src/app/api/oas/route.ts
// GET /api/oas  — OA一覧（ユーザーがメンバーの OA のみ）
// POST /api/oas — OA作成（作成者を owner として自動登録）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { createOaSchema, oaQuerySchema, formatZodErrors } from "@/lib/validations";
import { getWorkspaceRole } from "@/lib/rbac";
import { ZodError } from "zod";

// ── モジュールロード時ログ ──────────────────────────────────
// このログが Vercel に出ない場合は古いキャッシュが使われている。
// BYPASS_AUTH の実値をここで記録することで、env var の反映も同時に確認できる。
console.log(
  `[/api/oas] module loaded BYPASS_AUTH_raw=${JSON.stringify(process.env.BYPASS_AUTH)}`
);

// ── GET /api/oas ─────────────────────────────────
export const GET = withAuth(async (req, _ctx, user) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = oaQuerySchema.parse({
      publish_status: searchParams.get("publish_status") ?? undefined,
      page:           searchParams.get("page")           ?? 1,
      limit:          searchParams.get("limit")          ?? 20,
    });

    // dev スタブ（dev-user）の場合は全 OA を返す
    // 本番（Supabase 設定済み）では workspace_members に登録済みの OA のみ返す
    const isDevUser =
      !process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NODE_ENV === "development" &&
      user.id === "dev-user";

    const memberFilter = isDevUser
      ? {}
      : {
          id: {
            in: (
              await prisma.workspaceMember.findMany({
                where: { userId: user.id },
                select: { workspaceId: true },
              })
            ).map((m) => m.workspaceId),
          },
        };

    const where = {
      ...memberFilter,
      ...(query.publish_status ? { publishStatus: query.publish_status } : {}),
    };
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await prisma.$transaction([
      prisma.oa.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.limit,
        select: {
          id:             true,
          title:          true,
          description:    true,
          channelId:      true,
          publishStatus:  true,
          richMenuId:     true,
          spreadsheetId:  true,
          createdAt:      true,
          updatedAt:      true,
          _count: { select: { works: true } },
        },
      }),
      prisma.oa.count({ where }),
    ]);

    // 各 OA の role を並列取得
    const rolesMap = new Map<string, string>();
    for (const oa of items) {
      const r = await getWorkspaceRole(oa.id, user.id);
      rolesMap.set(oa.id, r ?? 'none');
    }

    const data = items.map((oa) => ({
      id:             oa.id,
      title:          oa.title,
      description:    oa.description,
      channel_id:     oa.channelId,
      publish_status: oa.publishStatus,
      rich_menu_id:   oa.richMenuId   ?? null,
      spreadsheet_id: oa.spreadsheetId ?? null,
      created_at:     oa.createdAt,
      updated_at:     oa.updatedAt,
      _count:         oa._count,
      my_role:        rolesMap.get(oa.id) ?? 'none',
    }));

    return ok(data, {
      total,
      page:  query.page,
      limit: query.limit,
      pages: Math.ceil(total / query.limit),
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── POST /api/oas ────────────────────────────────
export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    const data = createOaSchema.parse(body);

    // OA 作成 + 作成者を owner として workspace_members に自動追加（トランザクション）
    const oa = await prisma.$transaction(async (tx) => {
      const newOa = await tx.oa.create({
        data: {
          title:              data.title,
          description:        data.description,
          channelId:          data.channel_id,
          channelSecret:      data.channel_secret,
          channelAccessToken: data.channel_access_token,
          publishStatus:      data.publish_status,
        },
      });

      // dev-user 以外のユーザーのみ明示的に workspace_members に登録
      // （dev-user は getWorkspaceRole で常に owner が返るため不要）
      if (
        process.env.NEXT_PUBLIC_SUPABASE_URL ||
        process.env.NODE_ENV !== "development" ||
        user.id !== "dev-user"
      ) {
        await tx.workspaceMember.create({
          data: {
            workspaceId: newOa.id,
            userId:      user.id,
            role:        "owner",
            invitedBy:   user.id,
          },
        });
      }

      return newOa;
    });

    return created({
      id:             oa.id,
      title:          oa.title,
      description:    oa.description,
      channel_id:     oa.channelId,
      publish_status: oa.publishStatus,
      rich_menu_id:   oa.richMenuId   ?? null,
      spreadsheet_id: oa.spreadsheetId ?? null,
      created_at:     oa.createdAt,
      updated_at:     oa.updatedAt,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
