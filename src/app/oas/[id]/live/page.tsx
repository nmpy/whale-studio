// src/app/oas/[id]/live/page.tsx
// Whale Studio Live ハブ（Server Component）。
// アクセスできる section（for Player / Admin / Actor）だけをカード表示する。
// owner / platform admin は全 section、liveRole 保持者は自分の section のみ。

import Link from "next/link";
import { getServerUser } from "@/lib/supabase/server";
import { canViewLiveSection } from "@/lib/live";
import type { LiveSection } from "@/lib/types/permissions";

export const dynamic = "force-dynamic";

// Whale Studio Live は Admin / Actor 集約の運営機能。
// Player 本人用ダッシュボードは作らない方針 (= Phase 2-C 整理)。
// /oas/[id]/live/player URL は placeholder として直アクセス時のみ表示するが、
// hub メニューには出さない。
const SECTIONS: { section: LiveSection; title: string; desc: string }[] = [
  {
    section: "admin",
    title: "Whale Studio Live for Admin",
    desc: "運営・主催者向けの管制画面。セッション、体験参加者、進行状況、イベントログを管理します。",
  },
  {
    section: "actor",
    title: "Whale Studio Live for Actor",
    desc: "演者向けの演出支援画面。担当プレイヤーの状態、推奨セリフ、接触後アクションを確認します。",
  },
];

export default async function LiveHubPage({ params }: { params: { id: string } }) {
  const user = await getServerUser();
  // layout の canAccessLive を通過しているので user は存在する。型のため null ガード。
  const userId = user?.id ?? "";

  const visibility = await Promise.all(
    SECTIONS.map((s) => canViewLiveSection(params.id, userId, s.section)),
  );
  const visibleSections = SECTIONS.filter((_, i) => visibility[i]);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "8px 0 40px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6, color: "#111827" }}>
        Whale Studio Live
      </h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24, lineHeight: 1.8 }}>
        リアルタイムに物語体験の進行・管制・演出支援を行う上位機能です（Phase 1: 準備中）。
        利用できる画面のみ表示しています。
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {visibleSections.map((s) => (
          <Link
            key={s.section}
            href={`/oas/${params.id}/live/${s.section}`}
            style={{
              display: "block",
              padding: "16px 18px",
              background: "#fff",
              border: "1px solid var(--border-light, #e5e5e5)",
              borderRadius: 12,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 6 }}>
              {s.title}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.7 }}>{s.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
