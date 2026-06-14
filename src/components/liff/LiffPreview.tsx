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
// プレビューでも noto_sans_jp / line_seed_jp プリセットを実フォントで確認できるよう同梱する。
import "@fontsource/line-seed-jp/400.css";
import "@fontsource/line-seed-jp/700.css";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/700.css";
import "@/app/liff/liff-font.css";

import { useEffect, useState, useMemo } from "react";
import type { LiffPageBlock, LiffPageConfig } from "@/types";
import { LiffMenuHomeRenderer, type LiffMenuHomePage } from "./LiffMenuHomeRenderer";
import { LiffSinglePageRenderer, type LiffSinglePage } from "./LiffSinglePageRenderer";
import type { LiffRenderContext } from "./LiffRenderer";
import type { CharacterInfo } from "./renderers";

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
    characters?: CharacterInfo[];
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
  // character_list ブロックのプレビュー表示用（作品のキャラクター）。
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);

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
          setCharacters(json.data.characters ?? []);
        }
      } catch {
        if (!cancelled) { setSiblings([]); setCharacters([]); }
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
  // 濃紺ヘッダー/太い黒ベゼルを廃止し、管理画面のカードトーン（白〜淡いグレー・薄い境界線・
  // やわらかい影・角丸）に揃えた軽い端末枠にする。「LIFF プレビュー」は小さなラベル扱い。
  const frame = (content: React.ReactNode) => (
    <div className="w-[375px] min-h-[600px] rounded-[32px] overflow-hidden border border-[#e3e8ec] bg-[#f5f8f6] shadow-[0_10px_30px_rgba(31,64,92,0.10)] shrink-0">
      <div className="flex items-center justify-center gap-2 py-2.5 bg-white border-b border-[#eef2f5]">
        <span className="w-7 h-1 rounded-full bg-[#e3e8ec]" />
        <span className="text-[10px] font-semibold tracking-[0.06em] text-[#9aa8a2]">LIFF プレビュー</span>
        <span className="w-7 h-1 rounded-full bg-[#e3e8ec]" />
      </div>
      <div className="overflow-auto bg-[#f5f8f6]" style={{ maxHeight: 720 }}>{content}</div>
    </div>
  );

  if (activePage) {
    const defaultPageCtx: LiffRenderContext = {
      userState: "before_start",
      progress:  { current: 0, total: 1 },
      evidences: [],
      hints:     [],
      characters,
      canResume: false,
    };
    return frame(
      <LiffSinglePageRenderer
        workId={workId ?? "preview"}
        workTitle={workTitle ?? ""}
        page={activePage}
        preview
        onBack={() => setViewingPageId(null)}
        defaultPageCtx={defaultPageCtx}
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
