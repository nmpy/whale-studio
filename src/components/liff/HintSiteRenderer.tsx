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

import { useEffect, useMemo, useState } from "react";
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
const DEFAULT_HEADER_FG = "#000000";

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
  const fixed = settings.header_fixed !== false;

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
        ctaLabel={settings.header_cta_label}
        ctaUrl={settings.header_cta_url}
        showHamburger={settings.show_hamburger}
        title={config.title}
      />

      <div
        style={fixed ? { paddingTop: `calc(${HEADER_HEIGHT_PX}px + env(safe-area-inset-top, 0px))` } : undefined}
      >
        <main className="max-w-md mx-auto px-4 py-5 flex flex-col gap-4 pb-24">
          {(config.title || config.description) && (
            <div className="space-y-1.5">
              {config.title && (
                <h1 className="text-[20px] leading-tight font-bold tracking-tight text-[color:var(--liff-primary-text)] break-words">
                  {config.title}
                </h1>
              )}
              {config.description && (
                <p className="text-[14px] leading-relaxed text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words">
                  {config.description}
                </p>
              )}
            </div>
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

function Header({
  fixed, logoUrl, logoAlt, ctaLabel, ctaUrl, showHamburger, title,
}: {
  fixed: boolean;
  logoUrl?: string;
  logoAlt?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  showHamburger?: boolean;
  title?: string | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
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
        className="max-w-md mx-auto flex items-center gap-2 px-4"
        style={{ height: HEADER_HEIGHT_PX }}
      >
        <div className="shrink-0 w-[120px] h-[36px] flex items-center">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={logoAlt || title || "logo"}
              className="max-w-full max-h-full"
              style={{ objectFit: "contain" }}
            />
          ) : (
            <span className="text-[16px] font-bold truncate">{title || "LIFF"}</span>
          )}
        </div>

        <div className="flex-1 min-w-0" />

        {ctaLabel && ctaUrl && (
          <a
            href={ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackHintSiteEvent("cta_click", { url: ctaUrl, label: ctaLabel, source: "header" })}
            className="shrink-0 px-3 py-1.5 text-xs font-bold rounded-full bg-white text-black border border-white whitespace-nowrap"
          >
            {ctaLabel}
          </a>
        )}

        {showHamburger && (
          <button
            type="button"
            aria-label="メニュー"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-md border border-current/20"
          >
            <span aria-hidden="true" className="text-xl leading-none">≡</span>
          </button>
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
      return <ButtonLinkBlock settings={s as ButtonLinkSettings} />;
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
