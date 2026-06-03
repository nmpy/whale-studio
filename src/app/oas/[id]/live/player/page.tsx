// src/app/oas/[id]/live/player/page.tsx
// Whale Studio Live for Player — Phase 2-B 最小UI。
// Server Component で section ガード → 中身は LivePlayerClient。

import { notFound } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { canViewLiveSection } from "@/lib/live";
import { LivePlayerClient } from "./LivePlayerClient";

export const dynamic = "force-dynamic";

export default async function LivePlayerPage({ params }: { params: { id: string } }) {
  const user = await getServerUser();
  if (!user || !(await canViewLiveSection(params.id, user.id, "player"))) {
    notFound();
  }
  return <LivePlayerClient oaId={params.id} />;
}
