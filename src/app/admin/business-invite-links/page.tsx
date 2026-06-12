// src/app/admin/business-invite-links/page.tsx
// 法人招待リンク発行ページ (Server Component / platform admin 専用)。
//
// セキュリティ:
//   - /admin/layout.tsx は platform admin OR workspace owner を許可するが、
//     このページは **platform admin 専用**。workspace owner も含め非 platform admin は redirect。
//   - クライアントガードは使わず、サーバーで getServerUser + isPlatformOwner を判定する。
//   - API 側 (/api/admin/business-invite-links) も platform admin 以外は 404 で二重防御。

import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { isPlatformOwner } from "@/lib/platform-admin";
import { BusinessInviteLinksClient } from "./_client";

// 認証 + platform admin 判定を必ず per-request で評価する (= 静的プリレンダーで
// redirect 結果を焼き込まないため)。既存の server-side admin ページと同じ方針。
export const dynamic = "force-dynamic";

export default async function BusinessInviteLinksPage() {
  const user = await getServerUser();
  if (!user) {
    redirect("/login?next=/admin/business-invite-links");
  }
  // platform admin 以外 (= workspace owner 含む) は OA 一覧へ redirect (= 存在を露出しない)
  if (!isPlatformOwner(user.id)) {
    redirect("/oas");
  }

  return <BusinessInviteLinksClient />;
}
