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

function RenderBlock({ block, ctx }: { block: LiffBlock; ctx: LiffRenderContext }) {
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
  const headerLabel = (workTitle ?? "").trim() || (title ?? "").trim() || "LIFF";
  const pageHeading = (title ?? "").trim();

  return (
    // LINE Design System に寄せたプレイヤー画面レイアウト。
    //   - 画面背景: --liff-background
    //   - ヘッダー: Primary Green (#06C755) / 文字色 #000000 を既定とする (作品名を表示)
    //   - コンテンツ: 画面左右 16px (px-4)、本文は max-w-md でスマホ前提
    //   - ページタイトルは本文先頭の h2 として描画 (ヘッダーと役割を分離)
    <div className={`liff-font ${liffRootClass(settings)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
      <header
        className="px-4 py-3"
        style={{
          background: "var(--liff-header-bg)",
          color: "var(--liff-header-text)",
        }}
      >
        <div className="max-w-md mx-auto">
          {/* 作品名は中央寄せ (LINE Design System Layout) */}
          <h1 className="text-[18px] leading-tight font-bold tracking-tight break-words text-center">
            {headerLabel}
          </h1>
        </div>
      </header>

      <main className="px-4 py-4 space-y-3 max-w-md mx-auto">
        {pageHeading && (
          <h2 className="text-[20px] leading-tight font-bold tracking-tight break-words text-[color:var(--liff-primary-text)] pt-1 text-center">
            {pageHeading}
          </h2>
        )}
        {visibleBlocks.length === 0 ? (
          <p className="text-center text-[color:var(--liff-tertiary-text)] py-12 text-sm">
            表示する項目がありません
          </p>
        ) : (
          visibleBlocks.map((block) => (
            <section
              key={block.id}
              className="bg-[color:var(--liff-surface)] rounded-[12px] px-4 py-3 border border-[color:var(--liff-border)]"
            >
              <RenderBlock block={block} ctx={ctx} />
            </section>
          ))
        )}

        {settings?.share_enabled && (
          <div className="pt-2">
            <LiffShareButton settings={settings} pageTitle={title || ""} preview={preview} />
          </div>
        )}
      </main>
    </div>
  );
}
