// src/app/oas/[id]/live/player/page.tsx
// Whale Studio Live for Player（Phase 1 準備中ページ）。

import { notFound } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { canViewLiveSection } from "@/lib/live";
import { LivePlaceholder } from "../_LivePlaceholder";

export const dynamic = "force-dynamic";

export default async function LivePlayerPage({ params }: { params: { id: string } }) {
  const user = await getServerUser();
  if (!user || !(await canViewLiveSection(params.id, user.id, "player"))) {
    notFound();
  }
  return (
    <LivePlaceholder
      oaId={params.id}
      title="Whale Studio Live for Player"
      description={
        "プレイヤーの行動・進行・演出連携を設定する画面です。\n" +
        "QR、チェックイン、謎の正解、メッセージ送信などを、Admin / Actor 側にどう表示するかを管理します。"
      }
    />
  );
}
