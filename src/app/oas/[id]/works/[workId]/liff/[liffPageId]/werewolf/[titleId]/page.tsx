"use client";

// src/app/oas/[id]/works/[workId]/liff/[liffPageId]/werewolf/[titleId]/page.tsx
//
// 人狼タイトル詳細編集ページ。LIFF 編集画面の「人狼 / 配役閲覧 - タイトル一覧」から
// 「編集」ボタン → このページに遷移。
//
// パンくず:
//   作品一覧 / <作品> / LIFF表示設定 / <LIFFページ> / 人狼 / <タイトル>

import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { ViewerBanner } from "@/components/PermissionGuard";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { WerewolfTitleDetailEditor } from "@/components/liff/werewolf/WerewolfTitleDetailEditor";

export default function WerewolfTitleDetailPage() {
  const params = useParams();
  const oaId       = params.id as string;
  const workId     = params.workId as string;
  const liffPageId = params.liffPageId as string;
  const titleId    = params.titleId as string;

  const { role, loading: roleLoading } = useWorkspaceRole(oaId);
  const isReadOnly = role === "viewer" || role === "tester";

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

  if (roleLoading) {
    return (
      <div className="p-6">
        <div className="h-6 w-48 bg-gray-200 rounded-md mb-4 animate-pulse" />
        <div className="h-48 bg-gray-100 rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div className="px-6 pb-6">
      <Breadcrumb
        items={[
          { label: "作品一覧",     href: `/oas/${oaId}/works` },
          { label: "作品",         href: `/oas/${oaId}/works/${workId}` },
          { label: "LIFF表示設定", href: `/oas/${oaId}/works/${workId}/liff` },
          { label: "LIFFページ",   href: `/oas/${oaId}/works/${workId}/liff/${liffPageId}` },
          { label: "人狼タイトル" },
        ]}
      />

      {isReadOnly && <ViewerBanner role={role} />}

      <div className="flex items-center justify-between mb-3 mt-2 flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-900">人狼 / 配役閲覧 — タイトル詳細</h1>
        <Link
          href={`/oas/${oaId}/works/${workId}/liff/${liffPageId}`}
          className="text-xs text-brand-ink underline"
        >
          ← LIFFページ編集に戻る
        </Link>
      </div>

      <WerewolfTitleDetailEditor
        workId={workId}
        liffPageConfigId={liffPageId}
        titleId={titleId}
        readOnly={isReadOnly}
        liffId={liffId}
      />
    </div>
  );
}
