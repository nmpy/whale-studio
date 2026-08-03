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
  LiffPageType,
} from "@/types";
import { normalizeLiffPageType } from "@/types";
import { HintSiteRenderer, type HintSiteBlock } from "./HintSiteRenderer";
import { FaqRenderer } from "./FaqRenderer";
import { SurveyRenderer } from "./SurveyRenderer";
import { TicketLinkRenderer } from "./TicketLinkRenderer";
import { ContactRenderer } from "./ContactRenderer";
import { LocationHistoryRenderer } from "./LocationHistoryRenderer";
import { CharacterRenderer, type CharacterRendererBlock } from "./CharacterRenderer";
import { PuzzleRenderer } from "./PuzzleRenderer";
import { WerewolfRenderer } from "./WerewolfRenderer";
import { LiffRenderer, LiffBlockSections, type LiffBlock, type LiffRenderContext } from "./LiffRenderer";
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

// PR-LB2: 「専用コンテンツの下に追加ブロックを補足表示するページ種別」の allow-list。
// PR-LB1 は denylist（default/hint/character/werewolf を除外）だったが、将来 page_type が増えた際に
// ActivePageContent の switch の default フォールバックと管理がズレて二重描画になるリスクを避けるため、
// 明示的な allow-list に変更（挙動は LB1 と同一。新規 page_type は既定で追加ブロック非表示＝安全側）。
//   含めない page_type の扱い:
//   - default : ブロックがメインコンテンツ（ActivePageContent の default 分岐で描画）
//   - hint / character : 専用 renderer 内部でブロックを描画する（二重化させない）
//   - werewolf : 専用テーブル運用でブロック非対応
const PAGE_TYPES_WITH_EXTRA_BLOCKS = new Set<LiffPageType>([
  "faq",
  "survey",
  "contact",
  "location",
  "puzzle",
]);

export function LiffSinglePageRenderer({
  workId, workTitle, page, preview = false, lineUserId = null,
  defaultPageCtx = DEFAULT_RENDER_CTX,
}: Props) {
  // ※ 独自ヘッダー（作品名バー + 閉じる）と「ホームに戻る」ボタンは、実機の LINE/LIFF
  //    デフォルトヘッダーと二重化する/冗長なため廃止。onBack / onClose props は後方互換で残すが描画しない。
  //    workTitle は document.title 同期（LINE デフォルトヘッダー表示用）で引き続き使用する。
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
        {/* 独自ヘッダー・「ホームに戻る」ボタンは廃止（実機 LINE ヘッダーと二重化するため）。
            本文はページタイトル → 説明 → ブロックから自然に始まる。 */}

        {/* ページタイトル — LiffPageConfig.title をそのまま使う (固定文言は出さない) */}
        {page.title && (
          <div className="liff-player-main pt-3 pb-2">
            <h2 className="text-[20px] font-bold leading-snug">{page.title}</h2>
            {page.description && (
              <p className="mt-1 text-[13px] leading-[1.7] text-[color:var(--liff-secondary-text)] break-words whitespace-pre-line">{page.description}</p>
            )}
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

        {/* PR-LB2: allow-list の page_type（faq/survey/contact/location/puzzle）でのみ、保存された追加ブロックを
            メインコンテンツの下に補足表示する。default/hint/character/werewolf は本体側で扱うため対象外。
            blocks が空なら LiffBlockSections が null を返す＝従来表示と差分なし。 */}
        {PAGE_TYPES_WITH_EXTRA_BLOCKS.has(pageType) && (
          <LiffBlockSections
            preview={preview}
            ctx={defaultPageCtx}
            showEmptyHint={false}
            blocks={page.blocks.map((b) => ({
              id:                        b.id,
              block_type:                b.block_type,
              sort_order:                b.sort_order ?? 0,
              title:                     b.title,
              settings_json:             (b.settings_json ?? {}) as Record<string, unknown>,
              visibility_condition_json: (b.visibility_condition_json ?? null) as LiffBlock["visibility_condition_json"],
            }))}
          />
        )}

        {showCredit && <LiffStudioFooter />}
      </div>
    </LiffPlayerProvider>
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
    case "ticket_link":
      return <TicketLinkRenderer workId={workId} preview={preview} />;
    case "contact":
      return (
        <ContactRenderer
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
    case "puzzle":
      // 謎・問題ページ。既存 riddle_list ブロック（RiddleListBlock）を薄い PuzzleRenderer で再利用。
      // データ取得 / status / spoiler-safe は RiddleListBlock + /puzzles API 側に一任（本 case は不変）。
      return (
        <PuzzleRenderer
          preview={preview}
          config={{
            work_title:    null,
            title:         page.title,
            description:   page.description,
            settings_json: settings,
          }}
        />
      );
    case "werewolf":
      // Phase 2: プレイ予定タイトル一覧 (アコーディオン) + マイページ (Phase 3 placeholder)。
      // 役職カード本体は QR 経由 (`/liff/r/[slotToken]`) でのみ閲覧可能。
      return (
        <WerewolfRenderer
          preview={preview}
          config={{
            work_id:             workId,
            liff_page_config_id: page.id,
            work_title:          null,
            title:               page.title,
            description:         page.description,
            settings_json:       settings,
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
