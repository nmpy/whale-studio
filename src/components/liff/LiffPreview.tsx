"use client";

// src/components/liff/LiffPreview.tsx
//
// 管理画面用スマホ幅プレビュー。
//
// 旧仕様: 編集中ページ単体を per-type renderer で表示するだけだった。
// 新仕様: **作品メニュー shell (LiffMenuShell)** を実機と同じく表示する。
//   - work 配下の他のページ (siblings) を /api/liff/works/[workId]/menu?preview=1 から取得
//   - 編集中ページ (= まだ未保存の draft) は in-memory で sibling 配列に上書き / 追加して
//     リアルタイムにプレビュー反映する
//   - LiffMenuShell の syncUrl は false (CMS では URL を書き換えない)
//
// 管理画面ルートでは LIFF レイアウトの CSS がロードされていないため、ここで明示的に import する。
import "@/app/liff/liff-font.css";

import { useEffect, useState, useMemo } from "react";
import type { LiffPageBlock, LiffPageConfig } from "@/types";
import { LiffMenuShell, type LiffMenuPage } from "./LiffMenuShell";

interface Props {
  blocks: LiffPageBlock[];
  /** 編集中の work ID (= 作品メニュー shell が他ページを取得するのに使う) */
  workId?: string;
  /** 編集中の LIFF ページ ID (= サーバから取った siblings 配列でこの id を編集中データに置換する) */
  pageId?: string;
  /** 作品名。ヘッダー表示に使う */
  workTitle?: string | null;
  /** 編集中ページのタイトル (in-progress) */
  title?: string | null;
  /** 編集中ページの page_type / settings_json / description / is_enabled (in-progress) */
  config?: Pick<LiffPageConfig, "page_type" | "settings_json" | "description" | "is_enabled" | "public_id"> | null;
}

interface MenuApiResponse {
  success: boolean;
  data?: {
    work_id:    string;
    work_title: string;
    pages:      LiffMenuPage[];
  };
}

/** 編集中の `LiffPageConfig` 部分から LiffMenuShell が期待する LiffMenuPage を組む。 */
function buildCurrentPage({
  pageId, blocks, title, config,
}: {
  pageId: string;
  blocks: LiffPageBlock[];
  title: string | null;
  config: Props["config"];
}): LiffMenuPage {
  return {
    id:            pageId,
    public_id:     config?.public_id ?? null,
    title,
    description:   config?.description ?? null,
    page_type:     config?.page_type ?? "default",
    is_enabled:    config?.is_enabled ?? true,
    settings_json: (config?.settings_json ?? {}) as LiffMenuPage["settings_json"],
    blocks: blocks
      .filter((b) => b.is_enabled)
      .map((b) => ({
        id:            b.id,
        block_type:    b.block_type,
        sort_order:    b.sort_order,
        title:         b.title,
        settings_json: (b.settings_json ?? {}) as Record<string, unknown>,
      })),
  };
}

export function LiffPreview({
  blocks, workId, pageId, workTitle, title, config,
}: Props) {
  // ── work 配下の他ページを取得 (preview=1 で draft も含める) ────────────────
  const [siblings, setSiblings] = useState<LiffMenuPage[]>([]);

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
  const mergedPages = useMemo<LiffMenuPage[]>(() => {
    if (!pageId) return siblings;
    const current = buildCurrentPage({ pageId, blocks, title: title ?? null, config });
    const exists = siblings.some((p) => p.id === pageId);
    if (exists) return siblings.map((p) => (p.id === pageId ? current : p));
    return [...siblings, current];
  }, [siblings, pageId, blocks, title, config]);

  return (
    <div className="w-[375px] min-h-[600px] bg-white rounded-2xl overflow-hidden border-[8px] border-gray-800 shadow-xl shrink-0">
      <div className="bg-gray-800 text-white py-2 px-4 text-[11px] font-semibold text-center">
        LIFF プレビュー
      </div>
      <div className="overflow-auto" style={{ maxHeight: 720 }}>
        <LiffMenuShell
          workId={workId ?? "preview"}
          workTitle={workTitle ?? ""}
          pages={mergedPages}
          activePagePublicId={config?.public_id ?? pageId ?? null}
          preview
          syncUrl={false}
        />
      </div>
    </div>
  );
}
