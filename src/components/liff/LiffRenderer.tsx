"use client";

// src/components/liff/LiffRenderer.tsx
// LIFF表示用ブロックレンダラー — block_type に応じてコンポーネントを切り替え

import type {
  LiffBlockType,
  LiffPageConfigSettings,
  VisibilityCondition,
  HeadingSettings,
  TextSettings,
  WarningSettings,
  ButtonLinkSettings,
  DividerSettings,
  AccordionSettings,
  CodeReaderSettings,
  RiddleListSettings,
  CheckinHistorySettings,
} from "@/types";
import {
  FreeTextBlock,
  StartButtonBlock,
  ResumeButtonBlock,
  ProgressBlock,
  EvidenceListBlock,
  HintListBlock,
  CharacterListBlock,
  ImageBlock,
  VideoBlock,
  HeadingBlock,
  TextBlock,
  WarningBlock,
  ButtonLinkBlock,
  DividerBlock,
  AccordionBlock,
  CodeReaderBlock,
  RiddleListBlock,
  CheckinHistoryBlock,
} from "./renderers";
import type { Evidence, Hint, CharacterInfo } from "./renderers";
import { liffRootClass } from "./liff-style-helpers";

export interface LiffBlock {
  id: string;
  block_type: LiffBlockType;
  sort_order: number;
  title: string | null;
  settings_json: Record<string, unknown>;
  visibility_condition_json: VisibilityCondition | null;
}

export type UserState = "before_start" | "in_progress" | "completed";

export interface LiffRenderContext {
  userState: UserState;
  progress?: { current: number; total: number };
  evidences?: Evidence[];
  hints?: Hint[];
  characters?: CharacterInfo[];
  canResume?: boolean;
  onStart?: () => Promise<void>;
  onResume?: () => Promise<void>;
}

function shouldShow(condition: VisibilityCondition | null, userState: UserState): boolean {
  if (!condition || condition === "always") return true;
  return condition === userState;
}

function RenderBlock({ block, ctx, preview }: { block: LiffBlock; ctx: LiffRenderContext; preview?: boolean }) {
  const s = block.settings_json;
  switch (block.block_type) {
    case "free_text":
      return <FreeTextBlock title={block.title} settings={s} />;
    case "start_button":
      return <StartButtonBlock settings={s} onStart={ctx.onStart} />;
    case "resume_button":
      return <ResumeButtonBlock settings={s} canResume={ctx.canResume ?? false} onResume={ctx.onResume} />;
    case "progress":
      return (
        <ProgressBlock
          title={block.title}
          settings={s}
          current={ctx.progress?.current ?? 0}
          total={ctx.progress?.total ?? 1}
        />
      );
    case "evidence_list":
      return <EvidenceListBlock title={block.title} settings={s} evidences={ctx.evidences ?? []} />;
    case "hint_list":
      return <HintListBlock title={block.title} settings={s} hints={ctx.hints ?? []} />;
    case "character_list":
      return <CharacterListBlock title={block.title} settings={s} characters={ctx.characters ?? []} />;
    case "image":
      return <ImageBlock settings={s} />;
    case "video":
      return <VideoBlock settings={s} />;
    case "heading":
      return <HeadingBlock title={block.title} settings={s as HeadingSettings} />;
    case "text":
      return <TextBlock title={block.title} settings={s as TextSettings} />;
    case "warning":
      return <WarningBlock settings={s as WarningSettings} />;
    case "button_link":
      return <ButtonLinkBlock settings={s as ButtonLinkSettings} blockId={block.id} />;
    case "divider":
      return <DividerBlock settings={s as DividerSettings} />;
    case "accordion":
      return <AccordionBlock title={block.title} settings={s as AccordionSettings} depth={1} blockId={block.id} />;
    case "code_reader":
      return <CodeReaderBlock settings={s as CodeReaderSettings} preview={preview} blockId={block.id} />;
    case "riddle_list":
      return <RiddleListBlock title={block.title} settings={s as RiddleListSettings} />;
    case "checkin_history":
      return <CheckinHistoryBlock title={block.title} settings={s as CheckinHistorySettings} preview={preview} />;
    default:
      return null;
  }
}

export function LiffRenderer({
  blocks,
  workTitle,
  title,
  ctx,
  settings,
  preview,
}: {
  blocks: LiffBlock[];
  /** 作品名。ヘッダーに表示する (新仕様)。未指定なら title にフォールバック */
  workTitle?: string | null;
  /** LIFF ページ名。本文先頭の h2 として表示する */
  title?: string | null;
  ctx: LiffRenderContext;
  /** ページ全体設定（シェアボタン制御などに使う） */
  settings?: LiffPageConfigSettings;
  /** プレビュー時は shareTargetPicker を呼ばない */
  preview?: boolean;
}) {
  return (
    // LINE Gift like モバイル閲覧 UI。
    //   - 背景白、画面内ヘッダーは廃止 (上部バー = document.title で表現)
    //   - 本文は .liff-player-main で max-w-md + 左右 16px を保証
    //   - ブロックは縦に並ぶフラットセクション (角丸カード積み重ねは廃止)
    // 管理画面のカードトーンに合わせ、淡いグレー背景の上に白い「資料集シート」カードを 1 枚置き、
    // その中にブロックを区切り線つきセクションで縦に並べる（LINE Gift 風の閲覧 UI）。
    <div className={`liff-font ${liffRootClass(settings)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
      <LiffBlockSections blocks={blocks} ctx={ctx} preview={preview} />
      {/* シェアボタンは廃止（settings.share_enabled は無視） */}
    </div>
  );
}

/**
 * ブロックを縦に並べる「資料集シート」カード（`<main>` + 白カード + 区切りセクション）。
 * LiffRenderer 本体（default ページ）と、専用ページ種別の「追加ブロック」表示の双方から再利用する [PR-LB1]。
 * - showEmptyHint=true（既定・default ページ）: 0 件なら「表示する項目がありません」を出す（従来挙動）。
 * - showEmptyHint=false（専用ページの追加ブロック）: 0 件なら何も描画しない（blocks 空＝従来表示を保つ）。
 */
export function LiffBlockSections({
  blocks,
  ctx,
  preview,
  showEmptyHint = true,
}: {
  blocks: LiffBlock[];
  ctx: LiffRenderContext;
  preview?: boolean;
  showEmptyHint?: boolean;
}) {
  const visibleBlocks = blocks.filter((b) =>
    shouldShow(b.visibility_condition_json, ctx.userState)
  );
  // 専用ページで追加ブロックが無い場合は何も出さない（カード枠も空文言も出さない）。
  if (visibleBlocks.length === 0 && !showEmptyHint) return null;

  return (
    <main className="liff-player-main pt-3 pb-8">
      <div className="rounded-[20px] border border-[#eef2f5] bg-[color:var(--liff-surface,#fff)] shadow-[0_6px_20px_rgba(31,64,92,0.06)] px-5 py-4">
        {visibleBlocks.length === 0 ? (
          <p className="text-center text-[color:var(--liff-tertiary-text)] py-12 text-sm">
            表示する項目がありません
          </p>
        ) : (
          /* セクションリスト:
             各ブロックの下に細い区切り線 + 上下に padding でメリハリを付ける。
             ただし accordion 自体が border-bottom を持つので二重罫線にならないよう、
             accordion ブロックは独自セパレータに任せる (親の border は出さない)。 */
          visibleBlocks.map((block, i) => {
            const isAccordion = block.block_type === "accordion";
            const isLast = i === visibleBlocks.length - 1;
            const sectionCls = isAccordion
              ? ""
              : isLast
                ? "pb-1"
                : "pb-5 mb-5 border-b border-[color:var(--liff-border)]";
            return (
              <div key={block.id} className={sectionCls}>
                <RenderBlock block={block} ctx={ctx} preview={preview} />
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}

