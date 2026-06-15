"use client";

// src/components/liff/CharacterRenderer.tsx
// LIFF Character モード — キャラクター紹介。
//
// 暫定実装: キャラクター CMS 側のデータ連携が未着手のため、最低限の空状態 UI を返す。
// blocks (LiffPageBlock) が登録されている場合はそれを既存 renderer (LiffRenderer) と
// 同じく出すので、運用側はテキスト/画像ブロックでキャラクター情報を組むことができる。

import type { LiffPageConfigSettings, LiffBlockType, HeadingSettings, TextSettings, WarningSettings, ButtonLinkSettings, DividerSettings, AccordionSettings } from "@/types";
import { liffRootClass, liffDescriptionAlignClass } from "./liff-style-helpers";
import { LiffEmptyState } from "./primitives/LiffEmptyState";
import {
  HeadingBlock,
  TextBlock,
  WarningBlock,
  ImageBlock,
  ButtonLinkBlock,
  DividerBlock,
  AccordionBlock,
} from "./renderers";

export interface CharacterRendererBlock {
  id:            string;
  block_type:    LiffBlockType;
  title:         string | null;
  settings_json: Record<string, unknown>;
}

export interface CharacterRendererConfig {
  work_title?:   string | null;
  title:         string | null;
  description:   string | null;
  settings_json: LiffPageConfigSettings;
  blocks:        CharacterRendererBlock[];
}

interface Props {
  config: CharacterRendererConfig;
  preview?: boolean;
}

export function CharacterRenderer({ config }: Props) {
  const settings = config.settings_json;
  const blocks = config.blocks ?? [];

  return (
    <div className={`liff-font ${liffRootClass(settings)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
      <div className="liff-player-main pt-2 pb-8 flex flex-col gap-4">
        {config.description && (
          <p className={`text-[14px] leading-relaxed text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words ${liffDescriptionAlignClass(settings)}`}>
            {config.description}
          </p>
        )}

        {blocks.length === 0 ? (
          <LiffEmptyState emoji="🎭" text="キャラクター情報はまだ登録されていません" />
        ) : (
          blocks.map((b, i) => {
            const isAccordion = b.block_type === "accordion";
            const isLast = i === blocks.length - 1;
            const sectionCls = isAccordion
              ? ""
              : isLast
                ? "pb-2"
                : "pb-6 mb-6 border-b border-[color:var(--liff-border)]";
            return (
              <div key={b.id} className={sectionCls}>
                <CharacterBlockSwitch block={b} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function CharacterBlockSwitch({ block }: { block: CharacterRendererBlock }) {
  const s = (block.settings_json ?? {}) as Record<string, unknown>;
  switch (block.block_type) {
    case "heading":
      return <HeadingBlock title={block.title} settings={s as HeadingSettings} />;
    case "text":
    case "free_text":
      return <TextBlock title={block.title} settings={s as TextSettings} />;
    case "warning":
      return <WarningBlock settings={s as WarningSettings} />;
    case "image":
      return <ImageBlock settings={s as never} />;
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
