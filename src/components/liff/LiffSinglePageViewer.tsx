"use client";

// src/components/liff/LiffSinglePageViewer.tsx
//
// `/liff/w/[workPublicId]/p/[pagePublicId]` の個別ページ表示用 wrapper。
//   - useLiffSDK で LIFF SDK を初期化
//   - /api/liff/works/[workId]/pages/[pageId] を fetch
//   - LiffSinglePageRenderer に渡す
//   - "戻る" ボタンは router.push でメニューホームへ

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiffSDK } from "@/hooks/useLiffSDK";
import { LiffSinglePageRenderer, type LiffSinglePage } from "./LiffSinglePageRenderer";
import type { LiffRenderContext } from "./LiffRenderer";
import type { CharacterInfo } from "./renderers";
import { recordLiffEvent } from "@/lib/liff-events";

interface Props {
  workId: string;
  pageId: string;
  /** メニューホーム URL を組み立てるための workPublicId. なければ /liff/work/{workId} を使う */
  workPublicId?: string;
}

interface PageApiResponse {
  success: boolean;
  data?: {
    work_id:    string;
    work_title: string;
    page_id?:   string;
    public_id?: string;
    title:      string | null;
    description: string | null;
    page_type:  string;
    publish_status: string;
    is_enabled?: boolean;
    settings_json: LiffSinglePage["settings_json"];
    /** character_list ブロック用。未同梱（旧API）でも落ちないよう optional。 */
    characters?: CharacterInfo[];
    blocks: LiffSinglePage["blocks"];
  };
  error?: { code?: string; message?: string };
}

export function LiffSinglePageViewer({ workId, pageId, workPublicId }: Props) {
  const liff = useLiffSDK();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isPreview = searchParams?.get("preview") === "1";

  const [page, setPage] = useState<(LiffSinglePage & { work_title: string }) | null>(null);
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!liff.ready) return;
    let cancelled = false;
    (async () => {
      try {
        const url = isPreview
          ? `/api/liff/works/${workId}/pages/${pageId}?preview=1`
          : `/api/liff/works/${workId}/pages/${pageId}`;
        const res = await fetch(url);
        const json = (await res.json()) as PageApiResponse;
        if (cancelled) return;
        if (res.status === 404 && json?.error?.code === "LIFF_DISABLED") {
          setError("このLIFFは現在無効になっています");
          return;
        }
        if (!json.success || !json.data) {
          setError(json.error?.message ?? "ページを読み込めませんでした");
          return;
        }
        const d = json.data;
        setPage({
          id:            d.page_id ?? pageId,
          public_id:     d.public_id ?? null,
          title:         d.title,
          description:   d.description,
          page_type:     d.page_type,
          is_enabled:    d.is_enabled ?? true,
          settings_json: d.settings_json,
          blocks:        d.blocks,
          work_title:    d.work_title,
        });
        setCharacters(d.characters ?? []);
      } catch {
        if (!cancelled) setError("サーバーに接続できませんでした");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workId, pageId, isPreview, liff.ready]);

  // page_view 計測 — preview 中はスキップ
  useEffect(() => {
    if (!page || isPreview) return;
    recordLiffEvent({
      workId,
      pageId:     page.id,
      lineUserId: liff.lineUserId,
      eventType:  "page_view",
      metadata:   { page_type: page.page_type, title: page.title },
      dedupeKey:  `page_view:${workId}:${page.id}:${liff.lineUserId ?? "anon"}`,
    });
  }, [page, isPreview, liff.lineUserId, workId]);

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

  if (error || !page) {
    return (
      <div className="min-h-screen bg-[color:var(--liff-background)] flex items-center justify-center p-4">
        <div className="bg-[color:var(--liff-surface)] rounded-[12px] px-4 py-6 border border-[color:var(--liff-border)] text-center max-w-sm w-full">
          <p className="text-4xl mb-3">😢</p>
          <h2 className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2">表示できません</h2>
          <p className="text-[14px] text-[color:var(--liff-secondary-text)]">{error ?? "ページを読み込めませんでした"}</p>
        </div>
      </div>
    );
  }

  const menuHref = workPublicId
    ? `/liff/w/${workPublicId}`
    : `/liff/work/${workId}`;

  // character_list ブロック用に characters を含む最小 ctx を渡す（default ページ種別で使用）。
  const defaultPageCtx: LiffRenderContext = {
    userState: "before_start",
    progress:  { current: 0, total: 1 },
    evidences: [],
    hints:     [],
    characters,
    canResume: false,
  };

  return (
    <LiffSinglePageRenderer
      workId={workId}
      workTitle={page.work_title}
      page={page}
      preview={isPreview}
      lineUserId={liff.lineUserId}
      onBack={() => router.push(menuHref)}
      onClose={liff.closeWindow}
      defaultPageCtx={defaultPageCtx}
    />
  );
}
