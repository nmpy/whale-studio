"use client";

// src/components/liff/LiffSinglePageRenderer.tsx
//
// 個別 LIFF ページ — `/liff/w/[workPublicId]/p/[pagePublicId]` の表示。
//
// 構成:
//   - ヘッダー (作品名 + 閉じるボタン) — メニューホームと統一
//   - 戻るボタン (= メニューホームへ)
//   - ページタイトル (LiffPageConfig.title をそのまま)
//   - 本文 — pageType ごとの既存 renderer (HintSiteRenderer / SurveyRenderer / 等) に委譲
//   - Powered by Whale Studio footer

import { useEffect } from "react";
import type {
  LiffPageConfigSettings,
  LiffBlockType,
} from "@/types";
import { normalizeLiffPageType } from "@/types";
import { HintSiteRenderer, type HintSiteBlock } from "./HintSiteRenderer";
import { FaqRenderer } from "./FaqRenderer";
import { SurveyRenderer } from "./SurveyRenderer";
import { LocationHistoryRenderer } from "./LocationHistoryRenderer";
import { CharacterRenderer, type CharacterRendererBlock } from "./CharacterRenderer";
import { WerewolfRenderer } from "./WerewolfRenderer";
import { LiffRenderer, type LiffBlock, type LiffRenderContext } from "./LiffRenderer";
import { LiffPlayerProvider } from "./LiffPlayerContext";
import { liffRootClass, resolveHeaderTitle } from "./liff-style-helpers";
import { LiffStudioFooter, shouldShowWhaleStudioCredit } from "./LiffStudioFooter";

export interface LiffSinglePage {
  id:             string;
  public_id?:     string | null;
  title:          string | null;
  description:    string | null;
  page_type:      string | null;
  is_enabled:     boolean;
  settings_json:  LiffPageConfigSettings;
  blocks: Array<{
    id:                        string;
    block_type:                LiffBlockType;
    sort_order?:               number;
    title:                     string | null;
    settings_json:             Record<string, unknown>;
    visibility_condition_json?: string | null;
  }>;
}

interface Props {
  workId:    string;
  workTitle: string;
  page:      LiffSinglePage;
  preview?:  boolean;
  lineUserId?: string | null;
  /** "戻る" ボタンの handler。実機なら router.push("/liff/w/[workPublicId]")、プレビューなら state リセット。 */
  onBack:    () => void;
  /** 右上閉じるボタンの handler。preview / 未指定なら非表示。 */
  onClose?:  () => void;
  /** "default" page 用の最小 render context。 */
  defaultPageCtx?: LiffRenderContext;
}

const DEFAULT_RENDER_CTX: LiffRenderContext = {
  userState: "before_start",
  progress:  { current: 0, total: 1 },
  evidences: [],
  hints:     [],
  characters: [],
  canResume: false,
};

export function LiffSinglePageRenderer({
  workId, workTitle, page, preview = false, lineUserId = null, onBack, onClose,
  defaultPageCtx = DEFAULT_RENDER_CTX,
}: Props) {
  const pageType = normalizeLiffPageType(page.page_type);
  const settings = page.settings_json;
  const showCredit = shouldShowWhaleStudioCredit(settings);

  // document.title を「作品名」と同期 (= メニューホームと同じ文字列)
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = resolveHeaderTitle({
      settings,
      workTitle,
      pageTitle: page.title,
    });
  }, [workTitle, page.title, settings]);

  const playerCtxValue = {
    workId,
    pageId:     page.id,
    lineUserId,
    preview,
  };

  return (
    <LiffPlayerProvider value={playerCtxValue}>
      <div className={`liff-font ${liffRootClass(settings)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
        <SinglePageHeader workTitle={workTitle} onClose={preview ? undefined : onClose} />

        {/* 戻るボタン */}
        <div className="liff-player-main pt-3 pb-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[color:var(--liff-secondary-text)] active:opacity-70 -ml-1 px-1 py-1"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            メニューに戻る
          </button>
        </div>

        {/* ページタイトル — LiffPageConfig.title をそのまま使う (固定文言は出さない) */}
        {page.title && (
          <div className="liff-player-main pt-2 pb-3">
            <h2 className="text-[20px] font-bold leading-snug">{page.title}</h2>
          </div>
        )}

        <ActivePageContent
          workId={workId}
          page={page}
          pageType={pageType}
          preview={preview}
          lineUserId={lineUserId}
          defaultPageCtx={defaultPageCtx}
        />

        {showCredit && <LiffStudioFooter />}
      </div>
    </LiffPlayerProvider>
  );
}

function SinglePageHeader({
  workTitle, onClose,
}: { workTitle: string; onClose?: () => void }) {
  return (
    <header className="sticky top-0 z-10 bg-[color:var(--liff-header-bg)] border-b border-[color:var(--liff-header-border)]">
      <div className="liff-player-main flex items-center min-h-[48px] py-2">
        <div className="w-8 shrink-0" aria-hidden="true" />
        <h1 className="flex-1 text-center text-[15px] font-bold text-[color:var(--liff-header-text)] truncate">
          {workTitle}
        </h1>
        <div className="w-8 shrink-0 flex justify-end">
          {onClose && (
            <button
              type="button"
              aria-label="閉じる"
              onClick={onClose}
              className="w-8 h-8 -mr-1 inline-flex items-center justify-center rounded-full text-[color:var(--liff-secondary-text)] active:bg-[color:var(--liff-surface-subtle,#F7F8FA)]"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function ActivePageContent({
  workId,
  page,
  pageType,
  preview,
  lineUserId,
  defaultPageCtx,
}: {
  workId: string;
  page: LiffSinglePage;
  pageType: ReturnType<typeof normalizeLiffPageType>;
  preview: boolean;
  lineUserId: string | null;
  defaultPageCtx: LiffRenderContext;
}) {
  const settings = page.settings_json;

  switch (pageType) {
    case "hint":
      return (
        <HintSiteRenderer
          preview={preview}
          config={{
            work_id:       workId,
            work_title:    null,
            title:         page.title,
            description:   page.description,
            settings_json: settings,
            blocks: page.blocks.map((b) => ({
              id:            b.id,
              block_type:    b.block_type,
              title:         b.title,
              settings_json: (b.settings_json ?? {}) as Record<string, unknown>,
            })) as HintSiteBlock[],
          }}
        />
      );
    case "faq":
      return (
        <FaqRenderer
          preview={preview}
          config={{
            work_title:    null,
            title:         page.title,
            description:   page.description,
            settings_json: settings,
          }}
        />
      );
    case "survey":
      return (
        <SurveyRenderer
          preview={preview}
          lineUserId={lineUserId}
          config={{
            work_id:       workId,
            page_id:       page.id,
            work_title:    null,
            title:         page.title,
            description:   page.description,
            settings_json: settings,
          }}
        />
      );
    case "location":
      return (
        <LocationHistoryRenderer
          preview={preview}
          lineUserId={lineUserId}
          config={{
            work_id:       workId,
            work_title:    null,
            title:         page.title,
            description:   page.description,
            settings_json: settings,
          }}
        />
      );
    case "character":
      return (
        <CharacterRenderer
          preview={preview}
          config={{
            work_title:    null,
            title:         page.title,
            description:   page.description,
            settings_json: settings,
            blocks: page.blocks.map((b) => ({
              id:            b.id,
              block_type:    b.block_type,
              title:         b.title,
              settings_json: (b.settings_json ?? {}) as Record<string, unknown>,
            })) as CharacterRendererBlock[],
          }}
        />
      );
    case "werewolf":
      // Phase 1: 暫定 placeholder のみ表示。
      // Phase 2 でプレイ予定一覧 / 配役カード閲覧 / ゲーム開始 gating を実装する。
      return (
        <WerewolfRenderer
          preview={preview}
          config={{
            work_title:    null,
            title:         page.title,
            description:   page.description,
            settings_json: settings,
          }}
        />
      );
    case "default":
    default:
      return (
        <LiffRenderer
          preview={preview}
          workTitle={null}
          title={page.title}
          settings={settings}
          ctx={defaultPageCtx}
          blocks={page.blocks.map((b) => ({
            id:                        b.id,
            block_type:                b.block_type,
            sort_order:                b.sort_order ?? 0,
            title:                     b.title,
            settings_json:             (b.settings_json ?? {}) as Record<string, unknown>,
            visibility_condition_json: (b.visibility_condition_json ?? null) as LiffBlock["visibility_condition_json"],
          }))}
        />
      );
  }
}

// 一部の型は LiffPreview からも参照可能にしておく
export type { HintSiteBlock, CharacterRendererBlock };
