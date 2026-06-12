// src/app/admin/personal-plan-permissions/page.tsx
// 個人プラン権限ページ (Server Component / platform admin 専用)。
//
// 現時点では個人利用アカウントのプラン・権限を操作する専用管理機能は存在しないため、
// 最小の空状態を表示する（将来、個人プラン変更 / tester plan 管理等を統合する想定）。
//
// セキュリティ: /admin/layout.tsx は platform admin OR workspace owner を許可するが、
//   このページは platform admin 専用。非該当 (workspace owner 含む) は redirect。
//   ナビ導線も platform admin のみ表示（AdminSidebar）。

import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { isPlatformOwner } from "@/lib/platform-admin";
import { PersonalPlanPermissionsClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function PersonalPlanPermissionsPage() {
  const user = await getServerUser();
  if (!user) {
    redirect("/login?next=/admin/personal-plan-permissions");
  }
  if (!isPlatformOwner(user.id)) {
    redirect("/oas");
  }

  return <PersonalPlanPermissionsClient />;
}
