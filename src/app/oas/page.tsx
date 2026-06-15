// src/app/oas/page.tsx
// アカウントリストのルート（Server Component）。
//
// 目的: アクセス可能な OA が「1 件のみ」のユーザーは、ここで対象 OA の作品一覧へ自動 redirect し、
//   アカウントリストの 1 クリックを省く（招待された editor 等が迷わず作品作成まで進めるように）。
//   - 0 件: 何もせず client（空状態 / 未参加導線）を表示。onboarding は layout の enforceOnboarding が担当。
//   - 2 件以上: 何もせず client（アカウントリスト）を表示。
//   - 1 件: /oas/[oaId]/works へ redirect（OA カードの遷移先と同一ルート）。
//
// 設計上の安全性:
//   - この redirect は **/oas インデックスでのみ**発火する（/oas/[id]/** のサブルートは別 page のため対象外）
//     ＝ リダイレクトループは起きない（遷移先 /oas/[id]/works は別ルート）。
//   - ログイン時に `next` 指定がある場合はログイン側がそこへ直接遷移するため、本 page には来ない
//     ＝ next 優先挙動を壊さない。
//   - 「アクセス可能な OA」の定義は onboarding-guard と同方針:
//     owner（ownerKey 一致）+ status=active の WorkspaceMember（role は問わない / active 以外は対象外）。
//   - migration なし。既存の作品一覧ページ・作成導線をそのまま利用。

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getServerUser } from "@/lib/supabase/server";
import { OaListClient } from "./_list-client";

export const dynamic = "force-dynamic";

export default async function OasPage() {
  const user = await getServerUser();

  // dev/bypass スタブや未認証（通常 layout で弾かれる）は判定対象外＝従来どおりリスト表示。
  if (user && user.id !== "bypass-admin" && user.id !== "dev-user") {
    const [memberships, owned] = await Promise.all([
      prisma.workspaceMember.findMany({
        where: { userId: user.id, status: "active" },
        select: { workspaceId: true },
      }),
      prisma.oa.findMany({
        where: { ownerKey: user.id },
        select: { id: true },
      }),
    ]);
    const accessibleOaIds = Array.from(
      new Set<string>([...memberships.map((m) => m.workspaceId), ...owned.map((o) => o.id)]),
    );
    if (accessibleOaIds.length === 1) {
      // OA カードクリックと同一の遷移先（作品一覧）へ。
      redirect(`/oas/${accessibleOaIds[0]}/works`);
    }
  }

  return <OaListClient />;
}
