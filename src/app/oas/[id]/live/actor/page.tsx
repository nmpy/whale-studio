// src/app/oas/[id]/live/actor/page.tsx
// Whale Studio Live for Actor — Phase 2-B 最小UI。
// Server Component で section ガード → 中身は LiveActorClient。

import { notFound } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { canViewLiveSection, canPreviewLiveActor } from "@/lib/live";
import { LiveActorClient } from "./LiveActorClient";

export const dynamic = "force-dynamic";

export default async function LiveActorPage({ params }: { params: { id: string } }) {
  const user = await getServerUser();
  if (!user || !(await canViewLiveSection(params.id, user.id, "actor"))) {
    notFound();
  }
  // Phase 2-J: 「表示確認モード」(= Owner/Admin が任意 Actor 視点で閲覧) の可否
  const canPreview = await canPreviewLiveActor(params.id, user.id);
  return <LiveActorClient oaId={params.id} canPreview={canPreview} />;
}
