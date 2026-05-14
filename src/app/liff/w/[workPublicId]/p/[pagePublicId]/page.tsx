"use client";

// src/app/liff/w/[workPublicId]/p/[pagePublicId]/page.tsx
//
// 短縮公開 URL 用 LIFF プレイヤールート。
// 例: /liff/w/a7k3m9qx/p/b2c4d6f8
//
// 旧ルート (/liff/work/[workId]/pages/[pageId]) も併存。両方とも内部の API
// `/api/liff/works/{X}/pages/{Y}` を呼ぶが、X / Y は UUID でも publicId でも受け付ける。

import { useParams } from "next/navigation";
import { LiffPlayerViewer } from "@/components/liff/LiffPlayerViewer";

export default function LiffShortPageViewer() {
  const params = useParams();
  const workPublicId = params.workPublicId as string;
  const pagePublicId = params.pagePublicId as string;
  return (
    <LiffPlayerViewer
      workId={workPublicId}
      apiBaseUrl={`/api/liff/works/${workPublicId}/pages/${pagePublicId}`}
    />
  );
}
