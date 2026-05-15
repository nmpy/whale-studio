"use client";

// src/components/liff/HintSiteRenderer.tsx
// ヒントサイト用 LIFF ページの全体レイアウト。
// 固定ヘッダー（ロゴ + CTA + ハンバーガー枠）、ブロック描画を担う。
//
// 設計の基本は LINE Design System for Messenger に準拠:
//   - ヘッダー既定色は LINE Primary Green (#06C755) / 文字色 #000000
//   - 画面左右 16px 余白（--liff-gutter）
//   - 本文 max-width はスマホ前提（max-w-md）
//   - ネタバレ注意はブロック (WarningBlock) スコープのみで扱う。
//     ※ 旧 settings.spoiler_warning_text は表示しない。データは互換のため残置。

import { useEffect } from "react";
import type {
  LiffPageConfigSettings,
  HeadingSettings,
  TextSettings,
  WarningSettings,
  ImageBlockSettings,
  ButtonLinkSettings,
  DividerSettings,
  AccordionSettings,
  LiffBlockType,
} from "@/types";

export interface HintSiteBlock {
  id: string;
  block_type: LiffBlockType;
  title: string | null;
  settings_json: Record<string, unknown>;
}

export interface HintSiteConfig {
  work_id: string;
  /** 作品名。ヘッダーに表示する (新仕様)。logo_url 指定があるときはロゴ優先。 */
  work_title?: string | null;
  /** LIFF ページ名。本文先頭の h2 として表示する */
  title: string | null;
  description: string | null;
  settings_json: LiffPageConfigSettings;
  blocks: HintSiteBlock[];
}
import {
  HeadingBlock,
  TextBlock,
  WarningBlock,
  ImageBlock,
  ButtonLinkBlock,
  DividerBlock,
  AccordionBlock,
} from "./renderers";
import { trackHintSiteEvent } from "@/lib/liff-analytics";
import { LiffShareButton } from "./LiffShareButton";
import { liffRootClass, liffDescriptionAlignClass } from "./liff-style-helpers";

interface Props {
  config: HintSiteConfig;
  preview?: boolean;
}

// 旧 inline Header / theme.header_bg / header_logo_url 等は画面内ヘッダー廃止に伴い不要になった。
// 旧データ互換のため型 (LiffPageConfigSettings.theme / header_logo_url) と Zod は残置するが、
// renderer 側では参照しない。

export function HintSiteRenderer({ config, preview }: Props) {
  const settings: LiffPageConfigSettings = config.settings_json || {};

  useEffect(() => {
    if (preview) return;
    trackHintSiteEvent("page_view", { work_id: config.work_id, source: "hint_site" });
  }, [config.work_id, preview]);

  return (
    <div
      className={`liff-font ${liffRootClass(settings)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}
    >
      {/* 画面内ヘッダー (旧 Header コンポーネント) は廃止。
          作品名 / ロゴは document.title (= LIFF 上部バー) で表現する。
          ロゴ表示の旧 settings.header_logo_url は CMS で残してあるが、現状は描画していない。
          将来必要なら本文先頭の画像ブロックで代替できる。 */}
      <div>
        <main className="liff-player-main pt-6 pb-24">
          {/* ページタイトル h2 は廃止。ヘッダー文言 (header_title or work_title) で文脈表現。 */}
          {config.description && (
            <p className={`text-[14px] leading-relaxed text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words pb-6 mb-6 border-b border-[color:var(--liff-border)] ${liffDescriptionAlignClass(settings)}`}>
              {config.description}
            </p>
          )}

          {config.blocks.length === 0 ? (
            <p className="text-sm text-[color:var(--liff-tertiary-text)] text-center py-8">
              （ブロックが追加されていません）
            </p>
          ) : (
            /* セクションリスト: accordion 以外は border-bottom + padding で区切る。 */
            config.blocks.map((b, i) => {
              const isAccordion = b.block_type === "accordion";
              const isLast = i === config.blocks.length - 1;
              const sectionCls = isAccordion
                ? ""
                : isLast
                  ? "pb-2"
                  : "pb-6 mb-6 border-b border-[color:var(--liff-border)]";
              return (
                <div key={b.id} className={sectionCls}>
                  <BlockSwitch block={b} />
                </div>
              );
            })
          )}

          {settings.share_enabled && (
            <div className="pt-6">
              <LiffShareButton settings={settings} pageTitle={config.title || ""} preview={preview} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function BlockSwitch({ block }: { block: HintSiteBlock }) {
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
      return <ImageBlock settings={s as ImageBlockSettings} />;
    case "button_link":
      return <ButtonLinkBlock settings={s as ButtonLinkSettings} blockId={block.id} />;
    case "divider":
      return <DividerBlock settings={s as DividerSettings} />;
    case "accordion":
      return (
        <AccordionBlock
          title={block.title}
          settings={s as AccordionSettings}
          depth={1}
          blockId={block.id}
        />
      );
    default:
      return null;
  }
}
