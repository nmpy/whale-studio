// src/app/oas/[id]/live/admin/page.tsx
// Whale Studio Live for Admin（Phase 1 準備中ページ）。

import { notFound } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { canViewLiveSection } from "@/lib/live";
import { LivePlaceholder } from "../_LivePlaceholder";

export const dynamic = "force-dynamic";

export default async function LiveAdminPage({ params }: { params: { id: string } }) {
  const user = await getServerUser();
  if (!user || !(await canViewLiveSection(params.id, user.id, "admin"))) {
    notFound();
  }
  return (
    <LivePlaceholder
      oaId={params.id}
      title="Whale Studio Live for Admin"
      description={
        "運営・主催者向けの管制画面です。\n" +
        "全プレイヤーの進行状況、詰まり、接触状況、アラートを確認します。"
      }
    />
  );
}
