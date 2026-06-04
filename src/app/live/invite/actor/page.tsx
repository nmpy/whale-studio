// src/app/live/invite/actor/page.tsx
// Phase 2-J: 演者招待 URL の受諾画面。
//
// /oas/[id]/live/... layout は canAccessLive 判定で未受諾ユーザーを notFound に落とすため、
// 受諾 UI は OA scope の外 (= /live/invite/actor) に配置する。
// 未ログインなら /login へ。ログイン済みなら token を Client が POST → 成功で
// /oas/<oa_id>/live/actor へ navigate。

import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import InviteAcceptClient from "./InviteAcceptClient";

export const dynamic = "force-dynamic";

export default async function LiveInviteActorPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const user = await getServerUser();
  if (!user) {
    const nextUrl = `/live/invite/actor${
      searchParams.token ? `?token=${encodeURIComponent(searchParams.token)}` : ""
    }`;
    redirect(`/login?next=${encodeURIComponent(nextUrl)}`);
  }
  return <InviteAcceptClient token={searchParams.token ?? ""} />;
}
