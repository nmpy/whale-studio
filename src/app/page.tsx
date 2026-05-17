import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getServerAuthUser } from "@/lib/server-auth-user";
import { isPlatformOwner } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

type RecentOa = {
  id: string;
  title: string;
};

async function loadRecentOas(): Promise<RecentOa[]> {
  const user = await getServerAuthUser();
  if (!user) return [];

  const showAll = isPlatformOwner(user.id);
  const workspaceIds = showAll
    ? null
    : await prisma.workspaceMember.findMany({
        where: { userId: user.id, status: "active" },
        select: { workspaceId: true },
      }).then((members) => members.map((m) => m.workspaceId));

  if (workspaceIds && workspaceIds.length === 0) return [];

  const oas = await prisma.oa.findMany({
    where: workspaceIds ? { id: { in: workspaceIds } } : {},
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      id: true,
      title: true,
    },
  });

  return oas;
}

export default async function LandingPage() {
  const recents = await loadRecentOas();

  return (
    <div className="landing-root">
      <div className="landing-hero">
        <div className="landing-wordmark">
          <span className="landing-brand">WHALE STUDIO</span>
        </div>
        <span className="landing-subtitle">LINEでつくる物語体験 β版</span>
        <Link href="/oas" className="btn btn-primary landing-cta">
          体験をつくる
        </Link>
      </div>

      {recents.length > 0 && (
        <div className="landing-recents">
          <span className="landing-recents-label">最近使ったアカウント</span>
          <div className="landing-recents-list">
            {recents.map((oa) => (
              <Link key={oa.id} href={`/oas/${oa.id}/works`} className="landing-recent-chip">
                {oa.title}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
