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
            LINE Design System Layout に揃え、ページタイトルは中央寄せ。
            22px / 上品な読み物見出し。 */}
        {pageTitle && (
          <h2
            className="text-[22px] leading-tight font-bold break-words text-[color:var(--liff-primary-text)] text-center pt-1 pb-1"
            style={{ letterSpacing: "-0.005em" }}
          >
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
    <li className="border border-[color:var(--liff-border)] rounded-[16px] overflow-hidden bg-[color:var(--liff-surface)]">
      <button
        id={headerId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="w-full flex items-center justify-between gap-3 text-left px-5 min-h-[60px] py-3 transition-colors active:bg-[color:var(--liff-surface-subtle,#F7F8FA)]"
      >
        <span className="font-bold text-[16px] leading-snug break-words flex-1 min-w-0 text-[color:var(--liff-primary-text)]">
          {item.question?.trim() || "（質問未設定）"}
        </span>
        {/* AccordionBlock と同じ chevron。緑ボタン / 丸枠は使わない */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-[color:var(--liff-secondary-text)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="px-5 pt-4 pb-5 border-t border-[color:var(--liff-border)]"
        >
          <p
            className="text-[15px] leading-[1.8] whitespace-pre-wrap break-words text-[color:var(--liff-primary-text)]"
            style={{ letterSpacing: "0.02em" }}
          >
            {item.answer?.trim() || "（回答未設定）"}
          </p>
        </div>
      )}
    </li>
  );
}
