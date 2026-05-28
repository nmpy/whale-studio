// src/app/oas/[id]/live/actor/page.tsx
// Whale Studio Live for Actor（Phase 1 準備中ページ）。

import { notFound } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { canViewLiveSection } from "@/lib/live";
import { LivePlaceholder } from "../_LivePlaceholder";

export const dynamic = "force-dynamic";

export default async function LiveActorPage({ params }: { params: { id: string } }) {
  const user = await getServerUser();
  if (!user || !(await canViewLiveSection(params.id, user.id, "actor"))) {
    notFound();
  }
  return (
    <LivePlaceholder
      oaId={params.id}
      title="Whale Studio Live for Actor"
      description={
        "演者向けの演出支援画面です。\n" +
        "自分が接触すべきプレイヤー、プレイヤーの状態、推奨セリフ、接触後アクションを確認します。"
      }
    />
  );
}
