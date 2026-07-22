// src/app/admin/uzu-pro-grants/page.tsx
// ウズプロ権限（UzuProGrant）の付与/解除ページ（Server Component / platform owner 専用）。
//
// セキュリティ: /admin/layout.tsx は platform admin OR workspace owner を許可するが、
//   このページは platform owner 専用（運営操作のため）。非該当は notFound() で存在自体を隠す
//   （redirect ではなく 404 = ページの存在を推測させない）。API 側も platform owner 限定。
// 表示するのは Supabase の userId のみ（氏名/メール/プレイヤー情報は扱わない = PII 非表示）。

import { redirect, notFound } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { isPlatformOwner } from "@/lib/platform-admin";
import { UzuProGrantsClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function AdminUzuProGrantsPage() {
  const user = await getServerUser();
  if (!user) {
    redirect("/login?next=/admin/uzu-pro-grants");
  }
  if (!isPlatformOwner(user.id)) {
    notFound();
  }
  return <UzuProGrantsClient currentUserId={user.id} />;
}
