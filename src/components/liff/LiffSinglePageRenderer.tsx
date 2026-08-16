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
import { HintSearchRenderer } from "./HintSearchRenderer";
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
import { LiffFontThemeAssets } from "./fonts/LiffFontThemeAssets";
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
  // ※ 独自ヘッダー（作品名バー + 閉じる）と「戻る」ボタンは、実機の LINE/LIFF デフォルト
  //    ヘッダーと二重化する / ネイティブ UI の模倣になるため描画しない。
  //    検索型ヒント (hint_search) はメニューホームから **LIFF URL** で開くようにしてあり
  //    (lib/liff/menu-href.ts)、LIFF 間遷移として LINE ネイティブの戻るボタンが出る。
  //    onBack / onClose props は CMS プレビュー等の後方互換で残すが、ここでは描画しない。
  //    workTitle は document.title 同期（LINE デフォルトヘッダー表示用）で引き続き使用する。
  const pageType = normalizeLiffPageType(page.page_type);
  const settings = page.settings_json;
  const showCredit = shouldShowWhaleStudioCredit(settings);

  // ticket_link は 1 画面が「本文 + 下部操作エリア + フッター」で完結する縦長カード構成のため、
  // ページ見出しと Powered by を renderer 側のシェルが自前で描画する（親では二重に出さない）。
  // hint_search も検索 / 結果 / 詳細 / 一覧で見出しが変わるため、同じく renderer 側が見出しを持つ。
  // 他の page_type には影響しない。
  const ownsPageChrome = pageType === "ticket_link" || pageType === "hint_search";

  // 白背景シェルを敷くのは ticket_link だけ。hint_search は通常のページ背景のまま。
  const usesSurfaceBackground = pageType === "ticket_link";

  // ticket_link のシェルは高さに 100dvh を使い、この親は min-h-screen(=100vh) を使う。
  // iOS Safari / LINE アプリ内ブラウザではツールバー表示中に 100dvh < 100vh となるため、
  // 内容の短い画面では白いシェルの下に親の薄い背景が帯状に覗いてしまう。
  // モバイルでは親も白にして下端まで白を連続させ、sm 以上（中央カード表示）でのみ
  // 従来の外側背景へ戻す。base と sm: は別 variant なので Tailwind が必ず sm: を後に出力し、
  // 生成順に依存しない。他の page_type は従来どおり。
  const rootBackgroundClass = usesSurfaceBackground
    ? "bg-[color:var(--liff-surface)] sm:bg-[color:var(--liff-background)]"
    : "bg-[color:var(--liff-background)]";

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
      <div className={`liff-font ${liffRootClass(settings)} min-h-screen ${rootBackgroundClass} text-[color:var(--liff-primary-text)]`}>
        {/* font_theme=rounded / classic のときだけ webfont CSS を後から読む（DOM は出力しない）。
            テーマを持つ個別 renderer はすべてこの component 経由なので、ここ 1 か所で足りる。 */}
        <LiffFontThemeAssets settings={settings} />

        {/* ページタイトル — LiffPageConfig.title をそのまま使う (固定文言は出さない) */}
        {!ownsPageChrome && page.title && (
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

        {!ownsPageChrome && showCredit && <LiffStudioFooter />}
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
    case "hint_search":
      // 検索型ヒント。見出しは画面（検索 / 結果 / 詳細 / 一覧 / 質問）ごとに変わるため
      // HintSearchRenderer 側が自前で描画する（親では出さない）。
      // ヒント本体はページ API に含まれないので、実機では専用 API から都度取得する。
      // CMS プレビューだけ、編集中の settings をそのまま渡してローカル検索させる。
      return (
        <HintSearchRenderer
          workId={workId}
          pageId={page.public_id ?? page.id}
          preview={preview}
          pageTitle={page.title}
          pageDescription={page.description}
          showCredit={shouldShowWhaleStudioCredit(settings)}
          previewSource={preview ? {
            entries:       settings?.hint_search_entries,
            guideOptions:  settings?.hint_search_guide_options,
            guideQuestion: settings?.hint_search_guide_question,
          } : undefined}
        />
      );
    case "ticket_link":
      // タイトル / 説明 / Powered by は TicketLinkRenderer 側のシェルが 1 か所で描画する
      // （下部操作エリアより下にフッターが来る構成にするため）。親側では出さない。
      return (
        <TicketLinkRenderer
          workId={workId}
          preview={preview}
          pageTitle={page.title}
          pageDescription={page.description}
          showCredit={shouldShowWhaleStudioCredit(settings)}
        />
      );
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
