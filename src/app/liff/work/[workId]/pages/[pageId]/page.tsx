"use client";

// src/app/liff/work/[workId]/pages/[pageId]/page.tsx (旧 URL)
//
// 後方互換 URL: workId / pageId (UUID) で個別 LIFF ページを表示する。

import { useParams } from "next/navigation";
import { LiffSinglePageViewer } from "@/components/liff/LiffSinglePageViewer";

export default function LiffPageViewerPage() {
  const params = useParams();
  const workId = params.workId as string;
  const pageId = params.pageId as string;
  return (
    <LiffSinglePageViewer
      workId={workId}
      pageId={pageId}
      workPublicId={workId}
    />
  );
}
