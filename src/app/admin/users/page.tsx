// src/app/admin/users/page.tsx
// ユーザー一覧ページ（Server Component / platform admin 専用）。
//
// セキュリティ: /admin/layout.tsx は platform admin OR workspace owner を許可するが、
//   このページは platform admin 専用（全ユーザーの email 等を扱うため）。非該当は redirect。
//   ナビ導線も platform admin のみ表示（AdminSidebar の PLATFORM_NAV_ITEMS）。API も platform 限定。

import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { isPlatformOwner } from "@/lib/platform-admin";
import { AdminUsersClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const user = await getServerUser();
  if (!user) {
    redirect("/login?next=/admin/users");
  }
  if (!isPlatformOwner(user.id)) {
    redirect("/oas");
  }
  return <AdminUsersClient />;
}
