"use client";

// src/app/liff/work/[workId]/page.tsx
// LIFF表示ページ (旧 URL: workId のみ) — LINE内ブラウザ / 外部ブラウザ両対応
//
// 後方互換のため残す URL。今は作品メニュー shell (= タブ UI) を表示する。
// 旧仕様 "workId 配下で最も古いページを表示" は廃止。タブ UI から各 pageType を選んでもらう。

import { useParams } from "next/navigation";
import { LiffMenuPlayerViewer } from "@/components/liff/LiffMenuPlayerViewer";

export default function LiffViewerPage() {
  const params = useParams();
  const workId = params.workId as string;
  return <LiffMenuPlayerViewer workId={workId} />;
}
