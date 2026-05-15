"use client";

// src/components/liff/FaqRenderer.tsx
// LIFF FAQ モード — Q&A をアコーディオン形式で並べる。
// 空項目（question / answer どちらも空）はスキップする。

import { useState } from "react";
import type { FaqItem, LiffPageConfigSettings } from "@/types";
import { LiffShareButton } from "./LiffShareButton";
import { LiffPlayerHeader } from "./LiffPlayerHeader";
import { recordLiffEvent } from "@/lib/liff-events";
import { useLiffPlayerContext } from "./LiffPlayerContext";
import { liffRootClass, liffDescriptionAlignClass } from "./liff-style-helpers";

export interface FaqRendererConfig {
  /** 作品名。ヘッダーに表示する (新仕様)。未指定なら title にフォールバック */
  work_title?:   string | null;
  /** LIFF ページ名。本文側 h1 で表示する */
  title:         string | null;
  description:   string | null;
  settings_json: LiffPageConfigSettings;
}

export function FaqRenderer({ config, preview }: { config: FaqRendererConfig; preview?: boolean }) {
  const items = (config.settings_json.faq_items ?? []).filter(
    (it) => (it.question?.trim() ?? "") !== "" || (it.answer?.trim() ?? "") !== ""
  );
  const pageTitle = config.title?.trim();

  return (
    <div className={`liff-font ${liffRootClass(config.settings_json)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
      <LiffPlayerHeader workTitle={config.work_title} pageTitle={config.title} />
      <main className="max-w-md mx-auto px-4 py-5 flex flex-col gap-4 pb-24">
        {/* 本文先頭の見出しとして LIFF ページタイトル (page.title) を表示する。
            ヘッダーは作品名なので、本文側でページ単位のタイトルを出して区別する。
            LINE Design System Layout に揃え、ページタイトルは中央寄せ。 */}
        {pageTitle && (
          <h2 className="text-[20px] leading-tight font-bold tracking-tight break-words text-[color:var(--liff-primary-text)] text-center">
            {pageTitle}
          </h2>
        )}
        {config.description && (
          <p className={`text-[14px] leading-relaxed text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words ${liffDescriptionAlignClass(config.settings_json)}`}>
            {config.description}
          </p>
        )}

        {items.length === 0 ? (
          <p className="text-sm text-[color:var(--liff-tertiary-text)] text-center py-8">
            （Q&amp;A が登録されていません）
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item, idx) => (
              <FaqRow key={item.id ?? idx} item={item} index={idx} />
            ))}
          </ul>
        )}

        {config.settings_json.share_enabled && (
          <div className="pt-2">
            <LiffShareButton settings={config.settings_json} pageTitle={config.title || ""} preview={preview} />
          </div>
        )}
      </main>
    </div>
  );
}

function FaqRow({ item, index }: { item: FaqItem; index: number }) {
  const [open, setOpen] = useState(false);
  const playerCtx = useLiffPlayerContext();
  const panelId = `faq-panel-${index}`;
  const headerId = `faq-header-${index}`;
  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      // 開いた瞬間だけ faq_open を記録する。閉じる動作は計測しない。
      if (next && playerCtx && !playerCtx.preview) {
        const itemKey = item.id ?? `idx_${index}`;
        recordLiffEvent({
          workId:     playerCtx.workId,
          pageId:     playerCtx.pageId,
          lineUserId: playerCtx.lineUserId,
          eventType:  "faq_open",
          metadata:   { index, label: item.question?.trim() ?? "", item_id: item.id ?? null },
          dedupeKey:  `faq_open:${playerCtx.workId}:${playerCtx.pageId ?? "default"}:${itemKey}:${playerCtx.lineUserId ?? "anon"}`,
        });
      }
      return next;
    });
  };
  return (
    <li className="border border-[color:var(--liff-border)] rounded-[12px] overflow-hidden bg-[color:var(--liff-surface)]">
      <button
        id={headerId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="w-full flex items-center justify-between gap-3 text-left px-4 py-3"
      >
        <span className="font-bold text-[15px] leading-snug break-words flex-1 min-w-0">
          {item.question?.trim() || "（質問未設定）"}
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 w-6 h-6 rounded-full border border-[color:var(--liff-border)] flex items-center justify-center text-base font-bold leading-none"
        >
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="px-4 py-3 border-t border-[color:var(--liff-border)]"
        >
          <p className="text-[15px] leading-[1.6] whitespace-pre-wrap break-words text-[color:var(--liff-primary-text)]">
            {item.answer?.trim() || "（回答未設定）"}
          </p>
        </div>
      )}
    </li>
  );
}
