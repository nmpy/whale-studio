// src/app/oas/[id]/live/actor/page.tsx
// Whale Studio Live for Actor — Phase 2-B 最小UI。
// Server Component で section ガード → 中身は LiveActorClient。

import { notFound } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { canViewLiveSection } from "@/lib/live";
import { LiveActorClient } from "./LiveActorClient";

export const dynamic = "force-dynamic";

export default async function LiveActorPage({ params }: { params: { id: string } }) {
  const user = await getServerUser();
  if (!user || !(await canViewLiveSection(params.id, user.id, "actor"))) {
    notFound();
  }
  return <LiveActorClient oaId={params.id} />;
}
