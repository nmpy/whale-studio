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
import { LiffLoadingState, LiffErrorState } from "./ui";

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
    /** 作品メニューホームの任意設定（未設定は null）。 */
    home_title?:        string | null;
    home_description?:  string | null;
    home_image_url?:    string | null;
    home_header_title?: string | null;
    /** ホームメニュー表示モード。未指定は "card"。 */
    home_menu_layout?:  "card" | "list";
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

  // ホームの document.title を設定（LINE/LIFF デフォルトヘッダーのタイトル表示用）。
  // 優先: ホーム設定のヘッダータイトル → 作品名。独自 DOM ヘッダーは描画しない。
  useEffect(() => {
    if (typeof document === "undefined" || !data) return;
    document.title = data.home_header_title?.trim() || data.work_title || "LIFF";
  }, [data]);

  if (liff.loading || loading) {
    return <LiffLoadingState fullScreen />;
  }

  if (error || !data) {
    return <LiffErrorState fullScreen message={error ?? "メニューを読み込めませんでした"} />;
  }

  return (
    <LiffMenuHomeRenderer
      workTitle={data.work_title}
      pages={data.pages}
      homeTitle={data.home_title}
      homeDescription={data.home_description}
      homeImageUrl={data.home_image_url}
      homeMenuLayout={data.home_menu_layout}
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
