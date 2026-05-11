"use client";

// src/app/liff/work/[workId]/page.tsx
// LIFF表示ページ (旧 URL: workId のみ) — LINE内ブラウザ / 外部ブラウザ両対応
//
// 後方互換のため残す URL。workId 配下で最も古い (oldest) LIFF ページを表示する。
// 個別ページ指定は /liff/work/[workId]/pages/[pageId] を使う。

import { useParams } from "next/navigation";
import { LiffPlayerViewer } from "@/components/liff/LiffPlayerViewer";

export default function LiffViewerPage() {
  const params = useParams();
  const workId = params.workId as string;
  return <LiffPlayerViewer workId={workId} apiBaseUrl={`/api/liff/works/${workId}`} />;
}
