// src/app/api/oas/route.ts
// GET /api/oas  — OA一覧（ユーザーがメンバーの OA のみ）
// POST /api/oas — OA作成（作成者を owner として自動登録）

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { createOaSchema, oaQuerySchema, formatZodErrors } from "@/lib/validations";
import { isPlatformOwner } from "@/lib/platform-admin";
import { createTesterSubscription } from "@/lib/billing/create-tester-subscription";
import { genRequestId, runWithRequestId, withTiming } from "@/lib/perf";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

// ── モジュールロード時ログ ──────────────────────────────────
// このログが Vercel に出ない場合は古いキャッシュが使われている。
// BYPASS_AUTH の実値をここで記録することで、env var の反映も同時に確認できる。
console.log(
  `[/api/oas] module loaded BYPASS_AUTH_raw=${JSON.stringify(process.env.BYPASS_AUTH)}`
);

// ── GET /api/oas ─────────────────────────────────
export const GET = withAuth(async (req, _ctx, user) =>
  runWithRequestId(genRequestId(), () => withTiming("api/oas:GET", async () => {
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

    // メンバーシップでフィルタ。user_id ベースで WorkspaceMember を取得し、
    // さらに owner_key 一致 OA も補完（workspace_members 行が無くても owner と扱う rbac 方針に揃える）。
    // email NULL でも user_id 一致でメンバーとして扱われる（getWorkspaceRole / rbac.ts と同方針）。
    const memberships = showAll
      ? []
      : await prisma.workspaceMember.findMany({
          where: { userId: user.id },
          select: { workspaceId: true, role: true, status: true },
        });
    const ownedOaIds = showAll
      ? []
      : (await prisma.oa.findMany({
          where:  { ownerKey: user.id },
          select: { id: true },
        })).map((o) => o.id);
    if (process.env.NODE_ENV !== "production" || process.env.DEBUG_OAS === "true") {
      console.log(`[GET /api/oas] user.id=${user.id} showAll=${showAll} memberships=${JSON.stringify(memberships)} ownedOaIds=${JSON.stringify(ownedOaIds)}`);
    }

    const memberFilter = showAll
      ? {}
      : {
          id: { in: Array.from(new Set([...memberships.map((m) => m.workspaceId), ...ownedOaIds])) },
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
          ownerKey:       true,    // ループ内の getWorkspaceRole 呼び出しを排除するため追加（レスポンスには出さない）
          createdAt:      true,
          updatedAt:      true,
          _count: { select: { works: true } },
        },
      }),
      prisma.oa.count({ where }),
    ]);

    // 各 OA の role / アクセス可否を取得。
    // 旧実装: items.length 回の getWorkspaceRole（内部で oa.findUnique + workspaceMember.findUnique）を
    //         await ループで実行 → N+1。
    // 新実装: items の select に ownerKey を含め、自分の WorkspaceMember を 1 query で一括取得して
    //         Map で判定。rbac.ts の getWorkspaceRole と同じ優先順（owner_key 一致 → ADMIN_IDENTITY →
    //         active WorkspaceMember）を保持する。my_role / has_workspace_access の出力意味は不変。
    const itemIds = items.map((o) => o.id);
    const myMembers = itemIds.length === 0
      ? []
      : await prisma.workspaceMember.findMany({
          where:  { userId: user.id, workspaceId: { in: itemIds } },
          select: { workspaceId: true, role: true, status: true },
        });
    const memberByOaId = new Map(myMembers.map((m) => [m.workspaceId, m] as const));
    const adminIdentity = process.env.ADMIN_IDENTITY;

    const rolesMap  = new Map<string, string>();
    const accessMap = new Map<string, boolean>();
    for (const oa of items) {
      // 1. owner_key 最優先（rbac.ts と同方針）
      if (oa.ownerKey && oa.ownerKey === user.id) {
        rolesMap.set(oa.id, 'owner');
        accessMap.set(oa.id, true);
        continue;
      }
      // 2. ADMIN_IDENTITY フォールバック（owner_key 未設定時のみ）
      if (oa.ownerKey === null && adminIdentity && user.id === adminIdentity) {
        rolesMap.set(oa.id, 'owner');
        accessMap.set(oa.id, true);
        continue;
      }
      // 3. WorkspaceMember
      const m = memberByOaId.get(oa.id) ?? null;
      const role = m?.status === 'active' ? m.role : (showAll ? 'owner' : 'none');
      rolesMap.set(oa.id, role);
      // active member のみ has_workspace_access = true（owner_key fallback は上で処理済み）
      accessMap.set(oa.id, m !== null && m.status === 'active');
    }

    const data = items.map((oa) => ({
      id:                   oa.id,
      title:                oa.title,
      description:          oa.description,
      channel_id:           oa.channelId,
      line_oa_id:           oa.lineOaId     ?? null,
      publish_status:       oa.publishStatus,
      rich_menu_id:         oa.richMenuId   ?? null,
      spreadsheet_id:       oa.spreadsheetId ?? null,
      created_at:           oa.createdAt,
      updated_at:           oa.updatedAt,
      _count:               oa._count,
      my_role:              rolesMap.get(oa.id) ?? 'none',
      has_workspace_access: accessMap.get(oa.id) ?? false,
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
  }))
);

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
