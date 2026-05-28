// src/app/oas/[id]/live/layout.tsx
// Whale Studio Live の server guard。
// - 未ログイン → /login
// - Live 無効 OA / アクセス権なし（非メンバー・liveRole なしの studio admin 等）→ notFound()
//   （存在を露出しないため 403 ではなく 404）
//
// 親 /oas/layout.tsx の enforceOnboarding を通過した上で、さらに Live 固有の
// entitlement + 権限を server side で検証する（直 URL アクセスもここでブロック）。

import { notFound, redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { canAccessLive } from "@/lib/live";

export default async function LiveLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const user = await getServerUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/oas/${params.id}/live`)}`);
  }
  const allowed = await canAccessLive(params.id, user.id);
  if (!allowed) {
    notFound();
  }
  return <>{children}</>;
}
