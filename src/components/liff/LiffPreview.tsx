"use client";

// src/components/liff/LiffPreview.tsx
//
// 管理画面用スマホ幅プレビュー。
//
// 新仕様 (PR #61): /liff/w/[workPublicId] のトップメニュー + 個別ページ構成と同じ動きを CMS でも見せる。
//   - work 配下の他ページ (siblings) を /api/liff/works/[workId]/menu?preview=1 から取得
//   - 編集中ページ (= まだ未保存の draft) は in-memory で siblings に上書き / 追加して
//     リアルタイムにプレビュー反映する
//   - 初期表示はメニューホーム (カード一覧)。カードをタップで個別ページ表示に切替。
//     編集中のページがある場合はそれをデフォルト active にする (= 編集中の見た目を即確認)
//   - 個別ページの「戻る」ボタンでメニューホームに戻る
//
// 管理画面ルートでは LIFF レイアウトの CSS がロードされていないため、ここで明示的に import する。
import "@/app/liff/liff-font.css";

import { useEffect, useState, useMemo } from "react";
import type { LiffPageBlock, LiffPageConfig } from "@/types";
import { LiffMenuHomeRenderer, type LiffMenuHomePage } from "./LiffMenuHomeRenderer";
import { LiffSinglePageRenderer, type LiffSinglePage } from "./LiffSinglePageRenderer";

interface Props {
  blocks: LiffPageBlock[];
  workId?: string;
  pageId?: string;
  workTitle?: string | null;
  title?: string | null;
  config?: Pick<LiffPageConfig, "page_type" | "settings_json" | "description" | "is_enabled" | "public_id"> | null;
}

interface MenuApiResponse {
  success: boolean;
  data?: {
    work_id:    string;
    work_title: string;
    pages:      LiffMenuHomePage[];
  };
}

/** 編集中の LiffPageConfig 部分から LiffMenuHomeRenderer が期待する LiffMenuHomePage を組む。 */
function buildCurrentPage({
  pageId, blocks, title, config,
}: {
  pageId: string;
  blocks: LiffPageBlock[];
  title: string | null;
  config: Props["config"];
}): LiffMenuHomePage {
  return {
    id:            pageId,
    public_id:     config?.public_id ?? null,
    title,
    description:   config?.description ?? null,
    page_type:     config?.page_type ?? "default",
    is_enabled:    config?.is_enabled ?? true,
    settings_json: (config?.settings_json ?? {}) as LiffMenuHomePage["settings_json"],
    blocks: blocks
      .filter((b) => b.is_enabled)
      .map((b) => ({
        id:            b.id,
        block_type:    b.block_type,
        sort_order:    b.sort_order,
        title:         b.title,
        settings_json: (b.settings_json ?? {}) as Record<string, unknown>,
      })),
    created_at: null,
  };
}

export function LiffPreview({
  blocks, workId, pageId, workTitle, title, config,
}: Props) {
  // ── work 配下の他ページを取得 (preview=1 で draft も含める) ────────────────
  const [siblings, setSiblings] = useState<LiffMenuHomePage[]>([]);

  useEffect(() => {
    if (!workId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/liff/works/${workId}/menu?preview=1`);
        const json = (await res.json()) as MenuApiResponse;
        if (cancelled) return;
        if (json.success && json.data) {
          setSiblings(json.data.pages);
        }
      } catch {
        if (!cancelled) setSiblings([]);
      }
    })();
    return () => { cancelled = true; };
  }, [workId]);

  // 編集中ページの最新スナップショットを sibling 配列に重ねて、リアルタイム反映する。
  const mergedPages = useMemo<LiffMenuHomePage[]>(() => {
    if (!pageId) return siblings;
    const current = buildCurrentPage({ pageId, blocks, title: title ?? null, config });
    const exists = siblings.some((p) => p.id === pageId);
    if (exists) return siblings.map((p) => (p.id === pageId ? current : p));
    return [...siblings, current];
  }, [siblings, pageId, blocks, title, config]);

  // ── view state: null = メニューホーム / 非 null = 個別ページ ─────────────
  // 初期表示は「編集中ページ」の個別ビュー (編集している内容を即確認できる)。
  // ただし pageId が無いケース (= リスト画面でのプレビュー等) はメニューホームを出す。
  const [viewingPageId, setViewingPageId] = useState<string | null>(pageId ?? null);

  // pageId が変わったら viewing を更新 (編集対象ページが切り替わったとき用)
  useEffect(() => {
    setViewingPageId(pageId ?? null);
  }, [pageId]);

  const activePage: LiffSinglePage | null = useMemo(() => {
    if (!viewingPageId) return null;
    const p = mergedPages.find((pp) => pp.id === viewingPageId);
    if (!p) return null;
    return {
      id:            p.id,
      public_id:     p.public_id ?? null,
      title:         p.title,
      description:   p.description,
      page_type:     p.page_type,
      is_enabled:    p.is_enabled,
      settings_json: p.settings_json,
      blocks:        p.blocks ?? [],
    };
  }, [mergedPages, viewingPageId]);

  // ── フレーム ──
  const frame = (content: React.ReactNode) => (
    <div className="w-[375px] min-h-[600px] bg-white rounded-2xl overflow-hidden border-[8px] border-gray-800 shadow-xl shrink-0">
      <div className="bg-gray-800 text-white py-2 px-4 text-[11px] font-semibold text-center">
        LIFF プレビュー
      </div>
      <div className="overflow-auto" style={{ maxHeight: 720 }}>{content}</div>
    </div>
  );

  if (activePage) {
    return frame(
      <LiffSinglePageRenderer
        workId={workId ?? "preview"}
        workTitle={workTitle ?? ""}
        page={activePage}
        preview
        onBack={() => setViewingPageId(null)}
      />
    );
  }

  return frame(
    <LiffMenuHomeRenderer
      workTitle={workTitle ?? ""}
      pages={mergedPages}
      preview
      onSelectCard={(page) => setViewingPageId(page.id)}
    />
  );
}
