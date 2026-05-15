"use client";

// src/components/liff/LiffPreview.tsx
// 管理画面用スマホ幅プレビュー。
// 実機 LIFF 表示とズレないよう、`.liff-font` ラッパー越しに同じデザイントークン
// (--liff-line-green / --liff-header-bg / --liff-primary-text 等) を継承する。
// プレビュー専用にスタイルを直書きせず、なるべく本物のレンダラーを使う。
//
// 管理画面ルートでは LIFF レイアウトの CSS がロードされていないため、ここで明示的に import する。
import "@/app/liff/liff-font.css";

import type { LiffPageBlock, LiffBlockType, LiffPageConfig } from "@/types";
import type {
  FreeTextSettings,
  StartButtonSettings,
  ResumeButtonSettings,
  ProgressSettings,
  EvidenceListSettings,
  HintListSettings,
  CharacterListSettings,
  ImageBlockSettings,
  VideoBlockSettings,
  HeadingSettings,
  TextSettings,
  WarningSettings,
  ButtonLinkSettings,
  DividerSettings,
  AccordionSettings,
} from "@/types";
import { HintSiteRenderer } from "./HintSiteRenderer";
import { FaqRenderer } from "./FaqRenderer";
import { SurveyRenderer } from "./SurveyRenderer";
import { LocationHistoryRenderer } from "./LocationHistoryRenderer";
import { LiffShareButton } from "./LiffShareButton";
import { normalizeLiffPageType } from "@/types";
import {
  HeadingBlock,
  TextBlock,
  WarningBlock,
  ButtonLinkBlock,
  DividerBlock,
  AccordionBlock,
  StartButtonBlock,
  ResumeButtonBlock,
  ProgressBlock,
  EvidenceListBlock,
  HintListBlock,
  CharacterListBlock,
  ImageBlock,
  VideoBlock,
  FreeTextBlock,
} from "./renderers";
import { liffRootClass, resolveHeaderTitle } from "./liff-style-helpers";

// 「ヒントの一覧」用ダミー
const SAMPLE_HINTS = [
  { id: "h1", text: "（プレビュー用ヒント）" },
];

function BlockPreviewContent({ block }: { block: LiffPageBlock }) {
  const s = block.settings_json as Record<string, unknown>;
  const t = block.block_type as LiffBlockType;
  switch (t) {
    case "free_text":      return <FreeTextBlock title={block.title} settings={s as FreeTextSettings} />;
    case "start_button":   return <StartButtonBlock settings={s as StartButtonSettings} />;
    case "resume_button":  return <ResumeButtonBlock settings={s as ResumeButtonSettings} canResume />;
    case "progress":       return <ProgressBlock title={block.title} settings={s as ProgressSettings} current={3} total={5} />;
    case "evidence_list":  return <EvidenceListBlock title={block.title} settings={s as EvidenceListSettings} evidences={[]} />;
    case "hint_list":      return <HintListBlock title={block.title} settings={s as HintListSettings} hints={SAMPLE_HINTS} />;
    case "character_list": return <CharacterListBlock title={block.title} settings={s as CharacterListSettings} characters={[]} />;
    case "image":          return <ImageBlock settings={s as ImageBlockSettings} />;
    case "video":          return <VideoBlock settings={s as VideoBlockSettings} />;
    case "heading":        return <HeadingBlock title={block.title} settings={s as HeadingSettings} />;
    case "text":           return <TextBlock title={block.title} settings={s as TextSettings} />;
    case "warning":        return <WarningBlock settings={s as WarningSettings} />;
    case "button_link":    return <ButtonLinkBlock settings={s as ButtonLinkSettings} />;
    case "divider":        return <DividerBlock settings={s as DividerSettings} />;
    case "accordion":      return <AccordionBlock title={block.title} settings={s as AccordionSettings} depth={1} blockId={block.id} />;
    default:               return <p className="text-xs text-gray-400">不明なブロック</p>;
  }
}

export function LiffPreview({
  blocks,
  workTitle,
  title,
  config,
}: {
  blocks: LiffPageBlock[];
  /** 作品名。ヘッダー表示に使う (新仕様) */
  workTitle?: string | null;
  /** LIFF ページ名。本文 h2 として表示する */
  title?: string | null;
  config?: Pick<LiffPageConfig, "page_type" | "settings_json" | "description"> | null;
}) {
  const enabledBlocks = blocks.filter((b) => b.is_enabled);
  const mode = normalizeLiffPageType(config?.page_type);
  // ヘッダーは settings.header_title 優先で、次に workTitle → pageTitle → fallback。
  // 本文 h2 (ページタイトル) は廃止。
  const headerLabel = resolveHeaderTitle({
    settings:  config?.settings_json,
    workTitle,
    pageTitle: title,
  }) || "LIFF ページ";

  // ── 共通フレーム ──
  const frame = (label: string, content: React.ReactNode) => (
    <div className="w-[375px] min-h-[600px] bg-white rounded-2xl overflow-hidden border-[8px] border-gray-800 shadow-xl shrink-0">
      <div className="bg-gray-800 text-white py-2 px-4 text-[11px] font-semibold text-center">{label}</div>
      <div className="overflow-auto" style={{ maxHeight: 720 }}>{content}</div>
    </div>
  );

  // ヒントサイトプレビュー — 実機と同じレンダラーをそのまま縮小表示する
  if (mode === "hint") {
    return frame("LIFF ヒントプレビュー", (
      <HintSiteRenderer
        preview
        config={{
          work_id:       "preview",
          work_title:    workTitle ?? null,
          title:         title ?? null,
          description:   config?.description ?? null,
          settings_json: config?.settings_json ?? {},
          blocks:        enabledBlocks.map((b) => ({
            id:            b.id,
            block_type:    b.block_type,
            title:         b.title,
            settings_json: (b.settings_json ?? {}) as Record<string, unknown>,
          })),
        }}
      />
    ));
  }

  if (mode === "faq") {
    return frame("LIFF FAQ プレビュー", (
      <FaqRenderer
        preview
        config={{
          work_title:    workTitle ?? null,
          title:         title ?? null,
          description:   config?.description ?? null,
          settings_json: config?.settings_json ?? {},
        }}
      />
    ));
  }

  if (mode === "survey") {
    return frame("LIFF アンケートプレビュー", (
      <SurveyRenderer
        preview
        config={{
          work_id:       "preview",
          work_title:    workTitle ?? null,
          title:         title ?? null,
          description:   config?.description ?? null,
          settings_json: config?.settings_json ?? {},
        }}
      />
    ));
  }

  if (mode === "location") {
    return frame("LIFF 履歴プレビュー", (
      <LocationHistoryRenderer
        preview
        config={{
          work_id:       "preview",
          work_title:    workTitle ?? null,
          title:         title ?? null,
          description:   config?.description ?? null,
          settings_json: config?.settings_json ?? {},
        }}
      />
    ));
  }

  // デフォルト (プレイヤー向け) プレビュー — LiffRenderer と同じレイアウト・色を再現する。
  return (
    <div className="w-[375px] min-h-[600px] bg-white rounded-2xl overflow-hidden border-[8px] border-gray-800 shadow-xl shrink-0">
      <div className="bg-gray-800 text-white py-2 px-4 text-[11px] font-semibold text-center">
        LIFF プレビュー
      </div>

      <div className={`liff-font ${liffRootClass(config?.settings_json)} bg-[color:var(--liff-background)] min-h-[560px]`}>
        <header
          className="px-4 h-14 flex items-center justify-center border-b"
          style={{
            background: "var(--liff-header-bg)",
            color: "var(--liff-header-text)",
            borderColor: "var(--liff-header-border)",
          }}
        >
          <div className="max-w-md mx-auto w-full">
            <h2 className="text-[17px] leading-tight font-bold break-words text-center truncate">
              {headerLabel}
            </h2>
          </div>
        </header>

        <div className="px-4 pt-6 pb-5 max-w-md mx-auto">
          {/* ページタイトル h3 は廃止。ヘッダー文言で文脈表現。 */}
          {enabledBlocks.length === 0 ? (
            <p className="text-[color:var(--liff-tertiary-text)] text-sm text-center py-10">
              ブロックが追加されていません
            </p>
          ) : (
            enabledBlocks.map((block, i) => {
              const isAccordion = block.block_type === "accordion";
              const isLast = i === enabledBlocks.length - 1;
              const sectionCls = isAccordion
                ? ""
                : isLast
                  ? "pb-2"
                  : "pb-6 mb-6 border-b border-[color:var(--liff-border)]";
              return (
                <div key={block.id} className={sectionCls}>
                  <BlockPreviewContent block={block} />
                </div>
              );
            })
          )}

          {config?.settings_json?.share_enabled && (
            <div className="pt-6">
              <LiffShareButton settings={config.settings_json} pageTitle={title || ""} preview />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
