import { prisma } from "@/lib/prisma";
import { isPlatformOwner } from "@/lib/platform-admin";
import { getServerAuthUser } from "@/lib/server-auth-user";
import { OaListClient, type OaListWorkItem } from "./OaListClient";
import type { OaListItem, OaListMeta } from "@/lib/api-client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

async function loadInitialOas(user: { id: string }): Promise<{
  items: OaListItem[];
  meta: OaListMeta;
  worksMap: Record<string, OaListWorkItem[]>;
}> {
  const showAll = isPlatformOwner(user.id);
  const memberships = showAll
    ? []
    : await prisma.workspaceMember.findMany({
        where: { userId: user.id },
        select: { workspaceId: true, role: true, status: true },
      });

  const memberFilter = showAll
    ? {}
    : { id: { in: memberships.map((m) => m.workspaceId) } };

  const where = memberFilter;
  const items = await prisma.oa.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
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
  });

  const total =
    items.length < PAGE_SIZE
      ? items.length
      : await prisma.oa.count({ where });

  const rolesMap = new Map<string, string>();
  if (showAll) {
    for (const oa of items) rolesMap.set(oa.id, "owner");
  } else {
    for (const m of memberships) {
      rolesMap.set(m.workspaceId, m.status === "active" ? m.role : "none");
    }
  }

  const oaIds = items.map((oa) => oa.id);
  const works = oaIds.length
    ? await prisma.work.findMany({
        where: { oaId: { in: oaIds } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id:    true,
          oaId:  true,
          title: true,
          _count: {
            select: {
              userProgress: { where: { isPreview: false } },
            },
          },
        },
      })
    : [];

  const worksMap: Record<string, OaListWorkItem[]> = {};
  for (const oaId of oaIds) worksMap[oaId] = [];
  for (const work of works) {
    worksMap[work.oaId]?.push({
      id: work.id,
      title: work.title,
      _count: { userProgress: work._count.userProgress },
    });
  }

  return {
    items: items.map((oa) => ({
      id:             oa.id,
      title:          oa.title,
      description:    oa.description,
      channel_id:     oa.channelId,
      line_oa_id:     oa.lineOaId ?? null,
      publish_status: oa.publishStatus as OaListItem["publish_status"],
      rich_menu_id:   oa.richMenuId ?? null,
      spreadsheet_id: oa.spreadsheetId ?? null,
      created_at:     oa.createdAt.toISOString(),
      updated_at:     oa.updatedAt.toISOString(),
      _count:         oa._count,
      my_role:        rolesMap.get(oa.id) ?? "none",
    })),
    meta: {
      total,
      page:  1,
      limit: PAGE_SIZE,
      pages: Math.ceil(total / PAGE_SIZE),
    },
    worksMap,
  };
}

export default async function OaListPage() {
  const user = await getServerAuthUser();

  if (!user) {
    return (
      <OaListClient
        initialItems={[]}
        initialMeta={{ total: 0, page: 1, limit: PAGE_SIZE, pages: 1 }}
        initialWorksMap={{}}
        initialError="認証情報を確認できませんでした。ログインし直してください。"
      />
    );
  }

  try {
    const initialData = await loadInitialOas(user);
    return (
      <OaListClient
        initialItems={initialData.items}
        initialMeta={initialData.meta}
        initialWorksMap={initialData.worksMap}
      />
    );
  } catch (error) {
    console.error("[/oas] initial load failed", error);
    return (
      <OaListClient
        initialItems={[]}
        initialMeta={{ total: 0, page: 1, limit: PAGE_SIZE, pages: 1 }}
        initialWorksMap={{}}
        initialError="アカウント一覧の読み込みに失敗しました"
      />
    );
  }
}
