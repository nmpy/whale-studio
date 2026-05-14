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

import { useEffect, useMemo } from "react";
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

interface Props {
  config: HintSiteConfig;
  preview?: boolean;
}

const HEADER_HEIGHT_PX = 56;

// LINE Design System のデフォルト色。settings.theme で上書き可能だが、
// 未設定時はこの値を使う（"#00000" などの不正値は無効として扱う）。
const DEFAULT_HEADER_BG = "#06C755";
const DEFAULT_HEADER_FG = "#ffffff";

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function normalizeColor(value: string | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  if (!v) return fallback;
  // # 始まりだが 6 桁になっていない（"#00000" 等の typo）ものは fallback。
  if (v.startsWith("#") && !HEX_COLOR_RE.test(v)) return fallback;
  return v;
}

export function HintSiteRenderer({ config, preview }: Props) {
  const settings: LiffPageConfigSettings = config.settings_json || {};
  // プレビュー (管理画面の縮小表示) では position:fixed が iframe 的にスクロールコンテナを抜けてしまい
  // 表示崩れを起こすので、プレビュー時は常に non-fixed に倒す。
  const fixed = !preview && settings.header_fixed !== false;

  useEffect(() => {
    if (preview) return;
    trackHintSiteEvent("page_view", { work_id: config.work_id, source: "hint_site" });
  }, [config.work_id, preview]);

  const themeStyle = useMemo<React.CSSProperties>(() => ({
    "--hint-header-bg": normalizeColor(settings.theme?.header_bg, DEFAULT_HEADER_BG),
    "--hint-header-fg": normalizeColor(settings.theme?.header_fg, DEFAULT_HEADER_FG),
  } as React.CSSProperties), [settings.theme]);

  return (
    <div
      className="liff-font min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]"
      style={themeStyle}
    >
      <Header
        fixed={fixed}
        logoUrl={settings.header_logo_url}
        logoAlt={settings.header_logo_alt}
        title={config.title}
      />

      <div
        style={fixed ? { paddingTop: `calc(${HEADER_HEIGHT_PX}px + env(safe-area-inset-top, 0px))` } : undefined}
      >
        <main className="max-w-md mx-auto px-4 py-5 flex flex-col gap-4 pb-24">
          {/* タイトルはヘッダーで表示する。本文側では重複させない (LIFF 仕様変更)。
              説明文 (description) のみ本文先頭に出す。 */}
          {config.description && (
            <p className="text-[14px] leading-relaxed text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words">
              {config.description}
            </p>
          )}

          {config.blocks.length === 0 ? (
            <p className="text-sm text-[color:var(--liff-tertiary-text)] text-center py-8">
              （ブロックが追加されていません）
            </p>
          ) : (
            config.blocks.map((b) => <BlockSwitch key={b.id} block={b} />)
          )}

          {settings.share_enabled && (
            <div className="pt-2">
              <LiffShareButton settings={settings} pageTitle={config.title || ""} preview={preview} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ヘッダー: ロゴ (or タイトル文字) のみを表示するシンプルな構成。
// 旧仕様で対応していた CTA ボタン / ハンバーガーメニュー枠は廃止した。
// settings 側に残っている header_cta_label / header_cta_url / show_hamburger は
// 互換性のため型・Zod 上は optional のまま残置するが、ここでは参照しない。
function Header({
  fixed, logoUrl, logoAlt, title,
}: {
  fixed: boolean;
  logoUrl?: string;
  logoAlt?: string;
  title?: string | null;
}) {
  return (
    <header
      className={`${fixed ? "fixed top-0 left-0 right-0 z-30" : ""}`}
      style={{
        background: "var(--hint-header-bg)",
        color: "var(--hint-header-fg)",
        paddingTop: fixed ? "env(safe-area-inset-top, 0px)" : undefined,
      }}
    >
      <div
        className="max-w-md mx-auto flex items-center px-4"
        style={{ height: HEADER_HEIGHT_PX }}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={logoAlt || title || "logo"}
            className="max-h-[36px] max-w-[160px]"
            style={{ objectFit: "contain" }}
          />
        ) : (
          // タイトルは最大 10 文字制限がフロント / API 両方で効いている前提のため、
          // ヘッダーでも省略せず全文表示する (truncate / ellipsis を付けない)。
          <span className="text-[16px] font-bold break-words">{title || "LIFF"}</span>
        )}
      </div>
    </header>
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
