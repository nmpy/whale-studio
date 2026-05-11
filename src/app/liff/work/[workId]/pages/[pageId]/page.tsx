"use client";

// src/app/liff/work/[workId]/pages/[pageId]/page.tsx
// LIFF表示ページ (新 URL: pageId 指定) — LINE内ブラウザ / 外部ブラウザ両対応

import { useParams } from "next/navigation";
import { LiffPlayerViewer } from "@/components/liff/LiffPlayerViewer";

export default function LiffPageViewerPage() {
  const params = useParams();
  const workId = params.workId as string;
  const pageId = params.pageId as string;
  return (
    <LiffPlayerViewer
      workId={workId}
      apiBaseUrl={`/api/liff/works/${workId}/pages/${pageId}`}
    />
  );
}
