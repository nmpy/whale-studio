"use client";

// src/app/liff/w/[workPublicId]/p/[pagePublicId]/page.tsx
//
// 短縮公開 URL の作品メニュー shell ルート (pagePublicId 指定版)。
// 例: /liff/w/a7k3m9qx/p/b2c4d6f8
//
// 新仕様: 作品メニュー shell (= タブ UI) を表示し、pagePublicId に該当するページの
// pageType (hint / location / survey / character ...) のタブを初期 active にする。
// 既存ブックマーク URL から開いても、ユーザーは目的のタブに直接ジャンプできる。

import { useParams } from "next/navigation";
import { LiffMenuPlayerViewer } from "@/components/liff/LiffMenuPlayerViewer";

export default function LiffShortPageViewer() {
  const params = useParams();
  const workPublicId = params.workPublicId as string;
  const pagePublicId = params.pagePublicId as string;
  return (
    <LiffMenuPlayerViewer
      workId={workPublicId}
      activePagePublicId={pagePublicId}
    />
  );
}
