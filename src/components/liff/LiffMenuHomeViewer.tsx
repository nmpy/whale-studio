"use client";

// src/components/liff/LiffMenuHomeViewer.tsx
//
// `/liff/w/[workPublicId]` 系のメニューホーム外側 wrapper。
//   - useLiffSDK で LIFF SDK を初期化
//   - /api/liff/works/[workId]/menu を fetch (preview=1 サポート)
//   - LiffMenuHomeRenderer に渡す
//
// カードをタップすると `<a href>` で個別ページ URL に遷移する。SPA 内 navigation だが、
// 実機 LIFF は ブラウザの history を素直に扱うため `<a>` で問題ない。

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiffSDK } from "@/hooks/useLiffSDK";
import { LiffMenuHomeRenderer, type LiffMenuHomePage } from "./LiffMenuHomeRenderer";

interface Props {
  /** UUID または publicId。API 側で両方を受け付ける。 */
  workId: string;
  /** URL の workPublicId. カードの遷移先 href 組み立てに使う。 */
  workPublicId: string;
}

interface MenuApiResponse {
  success: boolean;
  data?: {
    work_id:    string;
    work_title: string;
    pages:      LiffMenuHomePage[];
    /** Work.liffEnabled が false のとき API が返す。 */
    liff_disabled?: boolean;
  };
  error?: { code?: string; message?: string };
}

export function LiffMenuHomeViewer({ workId, workPublicId }: Props) {
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
        const url = isPreview
          ? `/api/liff/works/${workId}/menu?preview=1`
          : `/api/liff/works/${workId}/menu`;
        const res = await fetch(url);
        const json = (await res.json()) as MenuApiResponse;
        if (cancelled) return;
        if (res.status === 404 && json?.error?.code === "LIFF_DISABLED") {
          setError("このLIFFは現在無効になっています");
          return;
        }
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
          <h2 className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2">表示できません</h2>
          <p className="text-[14px] text-[color:var(--liff-secondary-text)]">{error ?? "メニューを読み込めませんでした"}</p>
        </div>
      </div>
    );
  }

  return (
    <LiffMenuHomeRenderer
      workTitle={data.work_title}
      pages={data.pages}
      preview={isPreview}
      onClose={liff.closeWindow}
      buildPageHref={(page) => {
        // 実機: 短縮 URL を組み立てる (publicId があれば優先)
        if (page.public_id) {
          return `/liff/w/${workPublicId}/p/${page.public_id}`;
        }
        return `/liff/work/${workId}/pages/${page.id}`;
      }}
    />
  );
}
