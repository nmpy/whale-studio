// src/app/admin/live/layout.tsx
// Whale Studio Live 管理は運営専用。/admin/layout.tsx は workspace owner も通すため、
// ここで platform admin のみに絞る（owner が直 URL で開いても notFound で隠す）。

import { notFound } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { isPlatformOwner } from "@/lib/platform-admin";

export default async function AdminLiveLayout({ children }: { children: React.ReactNode }) {
  const user = await getServerUser();
  if (!user || !isPlatformOwner(user.id)) {
    notFound();
  }
  return <>{children}</>;
}
