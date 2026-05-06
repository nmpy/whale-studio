"use client";

// src/components/liff/LiffPreview.tsx
// 管理画面用スマホ幅プレビュー — Tailwind ベース

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
import {
  HeadingBlock,
  TextBlock,
  WarningBlock,
  ButtonLinkBlock,
  DividerBlock,
  AccordionBlock,
} from "./renderers";

function PreviewFreeText({ title, settings }: { title?: string | null; settings: FreeTextSettings }) {
  return (
    <div className={settings.align === "center" ? "text-center" : "text-left"}>
      {title && <h3 className="text-sm font-semibold mb-1">{title}</h3>}
      <p className={`text-[13px] text-gray-700 whitespace-pre-wrap ${settings.emphasis === "strong" ? "font-bold text-gray-900" : ""}`}>
        {settings.body || "（テキスト未設定）"}
      </p>
    </div>
  );
}

function PreviewStartButton({ settings }: { settings: StartButtonSettings }) {
  return (
    <div className="w-full py-3 px-4 bg-[#06C755] text-white rounded-lg font-semibold text-sm text-center">
      {settings.label || "謎解きを始める"}
    </div>
  );
}

function PreviewResumeButton({ settings }: { settings: ResumeButtonSettings }) {
  return (
    <div className="w-full py-3 px-4 bg-blue-500 text-white rounded-lg font-semibold text-sm text-center">
      {settings.label || "途中から再開する"}
    </div>
  );
}

function PreviewProgress({ title, settings }: { title?: string | null; settings: ProgressSettings }) {
  const pct = 60;
  return (
    <div>
      {title && <h3 className="text-sm font-semibold mb-2">{title}</h3>}
      {settings.display_format === "text" ? (
        <p className="text-[13px] text-gray-700">3 / 5 フェーズ完了</p>
      ) : (
        <div>
          <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
            <div className="bg-[#06C755] h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-gray-500 mt-1 text-right">
            {settings.show_denominator !== false ? "3 / 5" : `${pct}%`}
          </p>
        </div>
      )}
    </div>
  );
}

function PreviewEvidenceList({ title, settings }: { title?: string | null; settings: EvidenceListSettings }) {
  return (
    <div>
      {title && <h3 className="text-sm font-semibold mb-2">{title}</h3>}
      <div className="bg-gray-50 rounded-lg p-3 text-center">
        <p className="text-xs text-gray-400">{settings.empty_message || "まだ証拠はありません"}</p>
      </div>
    </div>
  );
}

function PreviewHintList({ title, settings }: { title?: string | null; settings: HintListSettings }) {
  return (
    <div>
      {title && <h3 className="text-sm font-semibold mb-2">{title}</h3>}
      <div className="bg-amber-50 rounded-lg p-3 text-center">
        <p className="text-xs text-amber-700">{settings.empty_message || "ヒントはまだありません"}</p>
      </div>
    </div>
  );
}

function PreviewCharacterList({ title }: { title?: string | null }) {
  return (
    <div>
      {title && <h3 className="text-sm font-semibold mb-2">{title}</h3>}
      <div className="flex gap-3">
        {["A", "B", "C"].map((c) => (
          <div key={c} className="flex flex-col items-center gap-1">
            <div className="w-10 h-10 rounded-full bg-violet-200 flex items-center justify-center text-base font-semibold text-violet-600">
              {c}
            </div>
            <span className="text-[11px] text-gray-500">キャラ{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewImage({ settings }: { settings: ImageBlockSettings }) {
  return (
    <div>
      {settings.image_url ? (
        <img src={settings.image_url} alt={settings.alt || ""} className="w-full rounded-lg object-cover max-h-[200px]" />
      ) : (
        <div className="w-full h-[120px] bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-xs">
          画像未設定
        </div>
      )}
      {settings.caption && <p className="text-[11px] text-gray-500 mt-1 text-center">{settings.caption}</p>}
    </div>
  );
}

function PreviewVideo({ settings }: { settings: VideoBlockSettings }) {
  return (
    <div>
      <div className="w-full h-[160px] bg-gray-800 rounded-lg flex items-center justify-center text-white text-2xl">
        ▶
      </div>
      {settings.caption && <p className="text-[11px] text-gray-500 mt-1 text-center">{settings.caption}</p>}
    </div>
  );
}

function BlockPreviewContent({ block }: { block: LiffPageBlock }) {
  const s = block.settings_json as Record<string, unknown>;
  const t = block.block_type as LiffBlockType;
  switch (t) {
    case "free_text":      return <PreviewFreeText title={block.title} settings={s as FreeTextSettings} />;
    case "start_button":   return <PreviewStartButton settings={s as StartButtonSettings} />;
    case "resume_button":  return <PreviewResumeButton settings={s as ResumeButtonSettings} />;
    case "progress":       return <PreviewProgress title={block.title} settings={s as ProgressSettings} />;
    case "evidence_list":  return <PreviewEvidenceList title={block.title} settings={s as EvidenceListSettings} />;
    case "hint_list":      return <PreviewHintList title={block.title} settings={s as HintListSettings} />;
    case "character_list": return <PreviewCharacterList title={block.title} />;
    case "image":          return <PreviewImage settings={s as ImageBlockSettings} />;
    case "video":          return <PreviewVideo settings={s as VideoBlockSettings} />;
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
  title,
  config,
}: {
  blocks: LiffPageBlock[];
  title?: string | null;
  config?: Pick<LiffPageConfig, "page_type" | "settings_json" | "description"> | null;
}) {
  const enabledBlocks = blocks.filter((b) => b.is_enabled);

  if (config?.page_type === "hint_site") {
    return (
      <div className="w-[375px] min-h-[600px] bg-white rounded-2xl overflow-hidden border-[8px] border-gray-800 shadow-xl shrink-0">
        <div className="bg-gray-800 text-white py-2 px-4 text-[11px] font-semibold text-center">
          LIFF ヒントサイトプレビュー
        </div>
        <div className="overflow-auto" style={{ maxHeight: 720 }}>
          <HintSiteRenderer
            preview
            config={{
              work_id:       "preview",
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
        </div>
      </div>
    );
  }

  return (
    <div className="w-[375px] min-h-[600px] bg-white rounded-2xl overflow-hidden border-[8px] border-gray-800 shadow-xl shrink-0">
      <div className="bg-gray-800 text-white py-2 px-4 text-[11px] font-semibold text-center">
        LIFF プレビュー
      </div>

      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <h2 className="text-base font-bold text-gray-900">
          {title || "LIFF ページ"}
        </h2>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {enabledBlocks.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-10">
            ブロックが追加されていません
          </p>
        ) : (
          enabledBlocks.map((block) => (
            <div key={block.id}>
              <BlockPreviewContent block={block} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
