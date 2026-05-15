"use client";

// src/app/liff/w/[workPublicId]/page.tsx
//
// 短縮公開 URL の作品メニューホーム。カードをタップして個別ページに遷移する。
// 旧仕様 (PR #59 のタブ shell) は廃止し、トップメニュー + 個別ページ構成に変更。

import { useParams } from "next/navigation";
import { LiffMenuHomeViewer } from "@/components/liff/LiffMenuHomeViewer";

export default function LiffShortWorkViewer() {
  const params = useParams();
  const workPublicId = params.workPublicId as string;
  return <LiffMenuHomeViewer workId={workPublicId} workPublicId={workPublicId} />;
}
