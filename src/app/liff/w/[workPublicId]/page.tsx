"use client";

// src/app/liff/w/[workPublicId]/page.tsx
//
// 短縮公開 URL (workPublicId のみ指定) で workId 配下の最古ページを表示する。
// 旧ルート /liff/work/[workId] の短縮版。

import { useParams } from "next/navigation";
import { LiffPlayerViewer } from "@/components/liff/LiffPlayerViewer";

export default function LiffShortWorkViewer() {
  const params = useParams();
  const workPublicId = params.workPublicId as string;
  return (
    <LiffPlayerViewer
      workId={workPublicId}
      apiBaseUrl={`/api/liff/works/${workPublicId}`}
    />
  );
}
