"use client";

// src/app/liff/w/[workPublicId]/page.tsx
//
// 短縮公開 URL の作品メニュー shell ルート。
// 旧仕様 (workPublicId 配下の最古ページを表示) からタブ UI に切り替えた。

import { useParams } from "next/navigation";
import { LiffMenuPlayerViewer } from "@/components/liff/LiffMenuPlayerViewer";

export default function LiffShortWorkViewer() {
  const params = useParams();
  const workPublicId = params.workPublicId as string;
  return <LiffMenuPlayerViewer workId={workPublicId} />;
}
