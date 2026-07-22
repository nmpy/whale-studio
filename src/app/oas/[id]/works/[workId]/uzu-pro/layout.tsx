// src/app/oas/[id]/works/[workId]/uzu-pro/layout.tsx
// for ウズプロ（作品配下）の server guard。
// - 未ログイン → /login?next=...
// - for ウズプロのアクセス権なし（grant 非保有 / 非メンバー等）→ notFound()
//   （存在を露出しないため 403 ではなく 404）
//
// 親 /oas/[id]/works レイアウトの認可を通過した上で、さらに for ウズプロ固有の
// 権限（canAccessUzuPro）を server side で検証する（直 URL アクセスもここでブロック）。

import { notFound, redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { canAccessUzuPro } from "@/lib/uzupro";

export default async function UzuProLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string; workId: string };
}) {
  const user = await getServerUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/oas/${params.id}/works/${params.workId}/uzu-pro/player`)}`,
    );
  }
  if (!(await canAccessUzuPro(params.id, user.id, params.workId))) {
    notFound();
  }
  return <>{children}</>;
}
