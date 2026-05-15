"use client";

// src/app/liff/w/[workPublicId]/p/[pagePublicId]/page.tsx
//
// 短縮公開 URL の個別 LIFF ページ表示。
// 戻るボタンで /liff/w/[workPublicId] (作品メニューホーム) に遷移する。

import { useParams } from "next/navigation";
import { LiffSinglePageViewer } from "@/components/liff/LiffSinglePageViewer";

export default function LiffShortPageViewer() {
  const params = useParams();
  const workPublicId = params.workPublicId as string;
  const pagePublicId = params.pagePublicId as string;
  return (
    <LiffSinglePageViewer
      workId={workPublicId}
      pageId={pagePublicId}
      workPublicId={workPublicId}
    />
  );
}
