// src/app/admin/studio-invites/page.tsx
// 招待URL発行ページ (Server Component)。
//
// セキュリティ:
//   - /admin/layout.tsx が platform admin OR workspace owner を既にガードしている。
//   - 本機能は対象 OA の owner|admin が利用可能なため platform 専用にはしない（business-invite-links とは異なる）。
//   - 実際の発行可否は API (/api/admin/studio-invites) 側で対象 OA ごとに requireRole(owner|admin) で二重防御する。

import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { StudioInvitesClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function StudioInvitesPage() {
  const user = await getServerUser();
  if (!user) {
    redirect("/login?next=/admin/studio-invites");
  }
  return <StudioInvitesClient />;
}
