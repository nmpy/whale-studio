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
import { UnifiedStudioInvitesClient } from "./_unified-client";

export const dynamic = "force-dynamic";

// feature flag: ON のとき統合「招待URL発行」UI（個人/法人）を表示。OFF は既存UIのまま（後方互換）。
const UNIFIED_ENABLED = process.env.NEXT_PUBLIC_ENABLE_UNIFIED_STUDIO_INVITES === "true";

export default async function StudioInvitesPage() {
  const user = await getServerUser();
  if (!user) {
    redirect("/login?next=/admin/studio-invites");
  }
  return UNIFIED_ENABLED ? <UnifiedStudioInvitesClient /> : <StudioInvitesClient />;
}
