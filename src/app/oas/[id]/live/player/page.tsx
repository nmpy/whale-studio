// src/app/oas/[id]/live/player/page.tsx
// Whale Studio Live for Player — placeholder。
//
// 方針整理 (= Phase 2-C):
//   Whale Studio Live はプレイヤー本人用ダッシュボードを育てる方向ではなく、
//   Admin / Actor が体験参加者を管理する運営機能として整理する。プレイヤー本人は
//   LINE OA / LIFF / QR / チェックイン等を通じて体験するため、本ページは
//   placeholder のまま据え置きにする (= Live hub からも非表示)。

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
        "プレイヤー本人用画面は提供していません。\n" +
        "体験はLINE OA / LIFF / QR / チェックイン等を通じて行われます。\n" +
        "進行管理は Admin Console、演出支援は Actor Console をご利用ください。"
      }
    />
  );
}
