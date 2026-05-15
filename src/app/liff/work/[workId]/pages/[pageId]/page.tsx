"use client";

// src/app/liff/work/[workId]/pages/[pageId]/page.tsx
// LIFF表示ページ (旧 URL: pageId 指定) — LINE内ブラウザ / 外部ブラウザ両対応
//
// 旧仕様: 該当 pageId のページだけ表示
// 新仕様: 作品メニュー shell (= タブ UI) を表示し、pageId に該当するタブを初期 active にする。
//          既存ブックマーク URL から開いても、ユーザーは目的のタブに直接ジャンプできる。

import { useParams } from "next/navigation";
import { LiffMenuPlayerViewer } from "@/components/liff/LiffMenuPlayerViewer";

export default function LiffPageViewerPage() {
  const params = useParams();
  const workId = params.workId as string;
  const pageId = params.pageId as string;
  return (
    <LiffMenuPlayerViewer
      workId={workId}
      activePagePublicId={pageId}
    />
  );
}
