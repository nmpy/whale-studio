"use client";

// src/app/liff/work/[workId]/page.tsx (旧 URL)
//
// 後方互換 URL: workId (UUID) で作品メニューホームを表示する。
// 新規 URL は /liff/w/[workPublicId] の短縮形を使う。

import { useParams } from "next/navigation";
import { LiffMenuHomeViewer } from "@/components/liff/LiffMenuHomeViewer";

export default function LiffViewerPage() {
  const params = useParams();
  const workId = params.workId as string;
  return <LiffMenuHomeViewer workId={workId} workPublicId={workId} />;
}
