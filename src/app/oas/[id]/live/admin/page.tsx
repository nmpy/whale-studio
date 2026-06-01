// src/app/oas/[id]/live/admin/page.tsx
// Whale Studio Live for Admin — Phase 2-A 仮UI。
// Server Component で section ガード → 中身は LiveAdminClient。

import { notFound } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { canViewLiveSection } from "@/lib/live";
import { LiveAdminClient } from "./LiveAdminClient";

export const dynamic = "force-dynamic";

export default async function LiveAdminPage({ params }: { params: { id: string } }) {
  const user = await getServerUser();
  if (!user || !(await canViewLiveSection(params.id, user.id, "admin"))) {
    notFound();
  }
  return <LiveAdminClient oaId={params.id} />;
}
