import { Prisma } from "@prisma/client";
import { WorkListClient } from "./WorkListClient";
import { prisma } from "@/lib/prisma";
import { getServerAuthUser } from "@/lib/server-auth-user";
import { isPlatformOwner } from "@/lib/platform-admin";
import { getWorkspaceRole } from "@/lib/rbac";
import type { FriendAddSettings } from "@/types";
import type { WorkListItem } from "@/lib/api-client";
import type { InitialWorkLimitState } from "@/hooks/useWorkLimit";
import type { Role } from "@/lib/types/permissions";

export const dynamic = "force-dynamic";

type PageProps = {
  params: { id: string };
};

type WorkStatsRow = {
  work_id: string;
  character_count: number | bigint;
  phase_count: number | bigint;
  message_count: number | bigint;
  completed_count: number | bigint;
  in_progress_count: number | bigint;
};

function toCount(value: number | bigint | null | undefined): number {
  return Number(value ?? 0);
}

function formatWork(w: {
  id: string;
  oaId: string;
  title: string;
  description: string | null;
  publishStatus: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  _count: { characters: number; phases: number; messages: number; userProgress: number };
  phases: { startTrigger: string | null }[];
}, progressStats: { completed: number; in_progress: number }): WorkListItem {
  return {
    id: w.id,
    oa_id: w.oaId,
    title: w.title,
    description: w.description,
    publish_status: w.publishStatus as WorkListItem["publish_status"],
    sort_order: w.sortOrder,
    liff_enabled: true,
    system_character_id: null,
    welcome_message: null,
    read_receipt_mode: null,
    read_delay_ms: null,
    typing_enabled: null,
    typing_min_ms: null,
    typing_max_ms: null,
    loading_enabled: null,
    loading_threshold_ms: null,
    loading_min_seconds: null,
    loading_max_seconds: null,
    created_at: w.createdAt.toISOString(),
    updated_at: w.updatedAt.toISOString(),
    _count: w._count,
    start_trigger: w.phases[0]?.startTrigger ?? null,
    progress_stats: {
      total: progressStats.completed + progressStats.in_progress,
      completed: progressStats.completed,
      in_progress: progressStats.in_progress,
    },
  };
}

function formatFriendAdd(fa: {
  id: string;
  oaId: string;
  campaignName: string | null;
  addUrl: string;
  qrCodeUrl: string | null;
  shareImageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
} | null): FriendAddSettings | null {
  if (!fa) return null;
  return {
    id: fa.id,
    oa_id: fa.oaId,
    campaign_name: fa.campaignName,
    add_url: fa.addUrl,
    qr_code_url: fa.qrCodeUrl,
    share_image_url: fa.shareImageUrl,
    created_at: fa.createdAt.toISOString(),
    updated_at: fa.updatedAt.toISOString(),
  };
}

async function loadInitialData(oaId: string) {
  const emptyWorkLimit: InitialWorkLimitState = {
    maxWorks: null,
    planDisplayName: null,
    planName: null,
  };

  const user = await getServerAuthUser();
  if (!user) {
    return { oaTitle: "", works: [], friendAdd: null, workLimit: emptyWorkLimit, workspaceRole: null, error: "ログインが必要です" };
  }

  const isOwnerUser = isPlatformOwner(user.id);
  const oaPromise = prisma.oa.findUnique({
    where: { id: oaId },
    select: {
      title: true,
      subscription: {
        select: {
          plan: {
            select: {
              name: true,
              displayName: true,
              maxWorks: true,
            },
          },
        },
      },
    },
  });

  const rolePromise = isOwnerUser
    ? Promise.resolve<Role | null>("owner")
    : getWorkspaceRole(oaId, user.id).then((member) => {
        if (!member || member.status !== "active") return null;
        return member.role;
      });

  const worksPromise = prisma.work.findMany({
    where: { oaId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      oaId: true,
      title: true,
      description: true,
      publishStatus: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
      phases: {
        where: { phaseType: "start" },
        select: { startTrigger: true },
        take: 1,
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  const friendAddPromise = prisma.friendAddSettings.findUnique({
    where: { oaId },
    select: {
      id: true,
      oaId: true,
      campaignName: true,
      addUrl: true,
      qrCodeUrl: true,
      shareImageUrl: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const [oa, workspaceRole, works, friendAdd] = await Promise.all([
    oaPromise,
    rolePromise,
    worksPromise,
    friendAddPromise,
  ]);

  if (!oa) {
    return { oaTitle: "", works: [], friendAdd: null, workLimit: emptyWorkLimit, workspaceRole: null, error: "OAが見つかりません" };
  }

  if (!workspaceRole) {
    return {
      oaTitle: oa.title,
      works: [],
      friendAdd: null,
      workLimit: emptyWorkLimit,
      workspaceRole: null,
      error: "このワークスペースへのアクセス権がありません",
    };
  }

  const workIds = works.map((w) => w.id);
  const statsRows = workIds.length > 0
    ? await prisma.$queryRaw<WorkStatsRow[]>`
        SELECT
          w.id AS work_id,
          (SELECT COUNT(*)::int FROM characters WHERE work_id = w.id) AS character_count,
          (SELECT COUNT(*)::int FROM phases WHERE work_id = w.id) AS phase_count,
          (SELECT COUNT(*)::int FROM messages WHERE work_id = w.id) AS message_count,
          (SELECT COUNT(*)::int FROM user_progress WHERE work_id = w.id AND is_preview = false AND reached_ending = true) AS completed_count,
          (SELECT COUNT(*)::int FROM user_progress WHERE work_id = w.id AND is_preview = false AND reached_ending = false) AS in_progress_count
        FROM works w
        WHERE w.id IN (${Prisma.join(workIds)})
      `
    : [];

  const statsMap = new Map<string, WorkStatsRow>();
  for (const row of statsRows) statsMap.set(row.work_id, row);

  const progressMap: Record<string, { completed: number; in_progress: number }> = {};
  for (const row of statsRows) {
    progressMap[row.work_id] = {
      completed: toCount(row.completed_count),
      in_progress: toCount(row.in_progress_count),
    };
  }

  return {
    oaTitle: oa.title,
    works: works.map((w) => {
      const stats = statsMap.get(w.id);
      const progressStats = progressMap[w.id] ?? { completed: 0, in_progress: 0 };
      return formatWork({
        ...w,
        _count: {
          characters: toCount(stats?.character_count),
          phases: toCount(stats?.phase_count),
          messages: toCount(stats?.message_count),
          userProgress: progressStats.completed + progressStats.in_progress,
        },
      }, progressStats);
    }),
    friendAdd: formatFriendAdd(friendAdd),
    workLimit: {
      maxWorks: oa.subscription?.plan?.maxWorks ?? null,
      planDisplayName: oa.subscription?.plan?.displayName ?? null,
      planName: oa.subscription?.plan?.name ?? null,
    },
    workspaceRole,
    error: null,
  };
}

export default async function WorkListPage({ params }: PageProps) {
  try {
    const initial = await loadInitialData(params.id);
    return (
      <WorkListClient
        oaId={params.id}
        initialOaTitle={initial.oaTitle}
        initialWorks={initial.works}
        initialFriendAdd={initial.friendAdd}
        initialWorkLimit={initial.workLimit}
        initialWorkspaceRole={initial.workspaceRole}
        initialError={initial.error}
      />
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("[/oas/[id]/works] Prisma error", err.code, err.meta);
    } else {
      console.error("[/oas/[id]/works] SSR load failed", err);
    }

    return (
      <WorkListClient
        oaId={params.id}
        initialOaTitle=""
        initialWorks={[]}
        initialFriendAdd={null}
        initialWorkLimit={{ maxWorks: null, planDisplayName: null, planName: null }}
        initialWorkspaceRole={null}
        initialError="読み込みに失敗しました"
      />
    );
  }
}
