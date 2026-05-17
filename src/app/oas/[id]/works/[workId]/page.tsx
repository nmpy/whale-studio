import { Prisma } from "@prisma/client";
import { WorkHubClient } from "./WorkHubClient";
import { prisma } from "@/lib/prisma";
import { getServerAuthUser } from "@/lib/server-auth-user";
import { isPlatformOwner } from "@/lib/platform-admin";
import { getWorkspaceRole } from "@/lib/rbac";
import type { WorkListItem } from "@/lib/api-client";
import type { Role } from "@/lib/types/permissions";

export const dynamic = "force-dynamic";

type PageProps = {
  params: { id: string; workId: string };
};

type WorkStatsRow = {
  character_count: number | bigint;
  phase_count: number | bigint;
  message_count: number | bigint;
  transition_count: number | bigint;
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

async function loadInitialData(oaId: string, workId: string) {
  const user = await getServerAuthUser();
  if (!user) {
    return { oaTitle: "", work: null, phaseCount: 0, transCount: 0, workspaceRole: null, error: "ログインが必要です" };
  }

  const isOwnerUser = isPlatformOwner(user.id);
  const workPromise = prisma.work.findUnique({
    where: { id: workId },
    select: {
      id: true,
      oaId: true,
      title: true,
      description: true,
      publishStatus: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
      oa: { select: { title: true } },
      phases: {
        where: { phaseType: "start" },
        select: { startTrigger: true },
        take: 1,
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  const rolePromise = isOwnerUser
    ? Promise.resolve<Role | null>("owner")
    : getWorkspaceRole(oaId, user.id).then((member) => {
        if (!member || member.status !== "active") return null;
        return member.role;
      });

  const statsPromise = prisma.$queryRaw<WorkStatsRow[]>`
    SELECT
      (SELECT COUNT(*)::int FROM characters WHERE work_id = ${workId}) AS character_count,
      (SELECT COUNT(*)::int FROM phases WHERE work_id = ${workId} AND phase_type <> 'global') AS phase_count,
      (SELECT COUNT(*)::int FROM messages WHERE work_id = ${workId}) AS message_count,
      (SELECT COUNT(*)::int FROM transitions WHERE work_id = ${workId}) AS transition_count,
      (SELECT COUNT(*)::int FROM user_progress WHERE work_id = ${workId} AND is_preview = false AND reached_ending = true) AS completed_count,
      (SELECT COUNT(*)::int FROM user_progress WHERE work_id = ${workId} AND is_preview = false AND reached_ending = false) AS in_progress_count
  `;

  const [work, workspaceRole, statsRows] = await Promise.all([
    workPromise,
    rolePromise,
    statsPromise,
  ]);

  if (!work || work.oaId !== oaId) {
    return { oaTitle: work?.oa.title ?? "", work: null, phaseCount: 0, transCount: 0, workspaceRole: null, error: "作品が見つかりません" };
  }

  if (!workspaceRole) {
    return { oaTitle: work.oa.title, work: null, phaseCount: 0, transCount: 0, workspaceRole: null, error: "このワークスペースへのアクセス権がありません" };
  }

  const [stats] = statsRows;

  const characterCount = toCount(stats?.character_count);
  const phaseCount = toCount(stats?.phase_count);
  const messageCount = toCount(stats?.message_count);
  const transCount = toCount(stats?.transition_count);
  const progressStats = {
    completed: toCount(stats?.completed_count),
    in_progress: toCount(stats?.in_progress_count),
  };
  const userProgressCount = progressStats.completed + progressStats.in_progress;

  const workWithCounts = {
    ...work,
    _count: {
      characters: characterCount,
      phases: phaseCount,
      messages: messageCount,
      userProgress: userProgressCount,
    },
  };

  return {
    oaTitle: work.oa.title,
    work: formatWork(workWithCounts, progressStats),
    phaseCount,
    transCount,
    workspaceRole,
    error: null,
  };
}

export default async function WorkHubPage({ params }: PageProps) {
  try {
    const initial = await loadInitialData(params.id, params.workId);
    return (
      <WorkHubClient
        oaId={params.id}
        workId={params.workId}
        initialOaTitle={initial.oaTitle}
        initialWork={initial.work}
        initialPhaseCount={initial.phaseCount}
        initialTransCount={initial.transCount}
        initialWorkspaceRole={initial.workspaceRole}
        initialError={initial.error}
      />
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("[/oas/[id]/works/[workId]] Prisma error", err.code, err.meta);
    } else {
      console.error("[/oas/[id]/works/[workId]] SSR load failed", err);
    }

    return (
      <WorkHubClient
        oaId={params.id}
        workId={params.workId}
        initialOaTitle=""
        initialWork={null}
        initialPhaseCount={0}
        initialTransCount={0}
        initialWorkspaceRole={null}
        initialError="読み込みに失敗しました"
      />
    );
  }
}
