"use client";

// src/components/liff/LiffMenuPlayerViewer.tsx
//
// 作品メニュー shell を表示するためのプレイヤー外側 wrapper。
//
// 役割:
//   - LIFF SDK の初期化 (useLiffSDK)
//   - /api/liff/works/[workId]/menu からの全 LiffPageConfig 取得
//   - loading / error / 空状態のハンドリング
//   - LiffMenuShell に活性タブと SDK 由来の情報 (lineUserId / closeWindow) を渡す
//
// 旧 LiffPlayerViewer を置き換える形で 4 つの URL route から共通利用する:
//   - /liff/work/[workId]                       (workId 単体)
//   - /liff/work/[workId]/pages/[pageId]        (pageId 指定 — 該当タブを初期 active に)
//   - /liff/w/[workPublicId]                    (publicId 単体)
//   - /liff/w/[workPublicId]/p/[pagePublicId]   (publicId 指定 — 同上)

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiffSDK } from "@/hooks/useLiffSDK";
import { LiffMenuShell, type LiffMenuPage } from "./LiffMenuShell";

interface Props {
  /** 作品 ID か publicId。API 側で両方を受け付ける。 */
  workId: string;
  /** /p/[publicId] でアクセスされた場合の publicId。これと一致するページを初期 active に。 */
  activePagePublicId?: string;
}

interface MenuApiResponse {
  success: boolean;
  data?: {
    work_id:    string;
    work_title: string;
    pages:      LiffMenuPage[];
  };
  error?: { code?: string; message?: string };
}

export function LiffMenuPlayerViewer({ workId, activePagePublicId }: Props) {
  const liff = useLiffSDK();
  const searchParams = useSearchParams();
  const isPreview = searchParams?.get("preview") === "1";

  const [data, setData] = useState<MenuApiResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!liff.ready) return;
    let cancelled = false;
    (async () => {
      try {
        const apiUrl = isPreview
          ? `/api/liff/works/${workId}/menu?preview=1`
          : `/api/liff/works/${workId}/menu`;
        const res = await fetch(apiUrl);
        const json = (await res.json()) as MenuApiResponse;
        if (cancelled) return;
        if (!json.success || !json.data) {
          setError(json.error?.message ?? "メニューを読み込めませんでした");
          return;
        }
        setData(json.data);
      } catch {
        if (!cancelled) setError("サーバーに接続できませんでした");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workId, isPreview, liff.ready]);

  if (liff.loading || loading) {
    return (
      <div className="min-h-screen bg-[color:var(--liff-background)] flex items-center justify-center px-4">
        <div className="text-center">
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-3"
            style={{
              borderColor: "var(--liff-border)",
              borderTopColor: "var(--liff-line-green, #06C755)",
            }}
          />
          <p className="text-[14px] text-[color:var(--liff-secondary-text)]">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[color:var(--liff-background)] flex items-center justify-center p-4">
        <div className="bg-[color:var(--liff-surface)] rounded-[12px] px-4 py-6 border border-[color:var(--liff-border)] text-center max-w-sm w-full">
          <p className="text-4xl mb-3">😢</p>
          <h2 className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2">エラーが発生しました</h2>
          <p className="text-[14px] text-[color:var(--liff-secondary-text)]">{error ?? "メニューを読み込めませんでした"}</p>
        </div>
      </div>
    );
  }

  return (
    <LiffMenuShell
      workId={data.work_id}
      workTitle={data.work_title}
      pages={data.pages}
      activePagePublicId={activePagePublicId}
      preview={isPreview}
      lineUserId={liff.lineUserId}
      onClose={liff.closeWindow}
      syncUrl
    />
  );
}
