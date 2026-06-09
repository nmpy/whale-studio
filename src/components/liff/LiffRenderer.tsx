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
} from "@/types";
import { LiffShareButton } from "./LiffShareButton";
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
  const visibleBlocks = blocks.filter((b) =>
    shouldShow(b.visibility_condition_json, ctx.userState)
  );

  return (
    // LINE Gift like モバイル閲覧 UI。
    //   - 背景白、画面内ヘッダーは廃止 (上部バー = document.title で表現)
    //   - 本文は .liff-player-main で max-w-md + 左右 16px を保証
    //   - ブロックは縦に並ぶフラットセクション (角丸カード積み重ねは廃止)
    <div className={`liff-font ${liffRootClass(settings)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
      <main className="liff-player-main pt-6 pb-8">
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
                ? "pb-2"
                : "pb-6 mb-6 border-b border-[color:var(--liff-border)]";
            return (
              <div key={block.id} className={sectionCls}>
                <RenderBlock block={block} ctx={ctx} preview={preview} />
              </div>
            );
          })
        )}

        {settings?.share_enabled && (
          <div className="pt-6">
            <LiffShareButton settings={settings} pageTitle={title || ""} preview={preview} />
          </div>
        )}
      </main>
    </div>
  );
}

