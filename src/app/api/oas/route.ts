// src/app/api/oas/route.ts
// GET /api/oas  — OA一覧（ユーザーがメンバーの OA のみ）
// POST /api/oas — OA作成（作成者を owner として自動登録）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { createOaSchema, oaQuerySchema, formatZodErrors } from "@/lib/validations";
import { getWorkspaceRole } from "@/lib/rbac";
import { isPlatformOwner } from "@/lib/platform-admin";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";
// ── OA 作成時に tester subscription を自動設定 ────────────────────────
// fire-and-forget で呼び出す。失敗時は OA 作成をブロックしない。
// Plan シードが未実行の場合は no-op（testerPlan が null）。
async function createTesterSubscription(oaId: string): Promise<void> {
  const testerPlan = await prisma.plan.findUnique({ where: { name: "tester" } });
  if (!testerPlan) {
    console.warn("[POST /api/oas] tester plan not found — subscription skipped. Run `node prisma/seed.mjs`.");
    return;
  }
  const now = new Date();
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 1);
  await prisma.subscription.create({
    data: {
      oaId,
      planId:             testerPlan.id,
      status:             "trialing",
      currentPeriodStart: now,
      currentPeriodEnd:   end,
    },
  });
}

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

    // プラットフォームオーナーは全 OA を返す
    // それ以外は workspace_members に登録済みの OA のみ返す
    const showAll = isPlatformOwner(user.id);

    // メンバーシップでフィルタ
    const memberships = showAll
      ? []
      : await prisma.workspaceMember.findMany({
          where: { userId: user.id },
          select: { workspaceId: true, role: true, status: true },
        });
    if (process.env.NODE_ENV !== "production" || process.env.DEBUG_OAS === "true") {
      console.log(`[GET /api/oas] user.id=${user.id} showAll=${showAll} memberships=${JSON.stringify(memberships)}`);
    }

    const memberFilter = showAll
      ? {}
      : {
          id: { in: memberships.map((m) => m.workspaceId) },
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
          lineOaId:       true,
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

    // 各 OA の role を取得
    // プラットフォームオーナーはメンバー未登録の OA でも 'owner' として扱う
    const rolesMap = new Map<string, string>();
    for (const oa of items) {
      const m = await getWorkspaceRole(oa.id, user.id);
      const role = m?.status === 'active' ? m.role : (showAll ? 'owner' : 'none');
      rolesMap.set(oa.id, role);
    }

    const data = items.map((oa) => ({
      id:             oa.id,
      title:          oa.title,
      description:    oa.description,
      channel_id:     oa.channelId,
      line_oa_id:     oa.lineOaId     ?? null,
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
    // 本番環境で bypass-admin による作成を禁止
    if (process.env.NODE_ENV === "production" && user.id === "bypass-admin") {
      console.error("[POST /api/oas] 🚨 bypass-admin cannot create production OAs");
      return badRequest("bypass-admin ユーザーでは本番 OA を作成できません");
    }

    const isBypass = user.id === "bypass-admin" || user.id === "dev-user";
    if (isBypass) {
      console.warn("[POST /api/oas] ⚠️ BYPASS/DEV user creating OA — resources will be owned by stub user", {
        userId: user.id,
        bypass: process.env.BYPASS_AUTH === "true",
      });
    }

    const body = await req.json();
    const data = createOaSchema.parse(body);

    // OA 作成 + 作成者を owner として workspace_members に自動追加（トランザクション）
    const oa = await prisma.$transaction(async (tx) => {
      const newOa = await tx.oa.create({
        data: {
          title:              data.title,
          description:        data.description,
          channelId:          data.channel_id,
          lineOaId:           data.line_oa_id ?? null,
          channelSecret:      data.channel_secret,
          channelAccessToken: data.channel_access_token,
          publishStatus:      data.publish_status,
          ownerKey:           user.id,
        },
      });

      // 常に workspace_members に owner を登録する
      // （dev-user / bypass-admin でも DB に記録し、後から実ユーザーへ移行可能にする）
      await tx.workspaceMember.create({
        data: {
          workspaceId: newOa.id,
          userId:      user.id,
          role:        "owner",
          invitedBy:   user.id,
        },
      });

      console.log("[POST /api/oas] workspace_member created", {
        userId:  user.id,
        email:   user.email ?? "(none)",
        role:    "owner",
        oaId:    newOa.id,
        bypass:  isBypass,
      });

      return newOa;
    });

    // tester subscription を自動作成（fire-and-forget）
    // Plan シード未実行でも OA 作成レスポンスはブロックしない
    createTesterSubscription(oa.id).catch((e) =>
      console.error("[POST /api/oas] subscription auto-create failed:", e)
    );

    return created({
      id:             oa.id,
      title:          oa.title,
      description:    oa.description,
      channel_id:     oa.channelId,
      line_oa_id:     oa.lineOaId     ?? null,
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
