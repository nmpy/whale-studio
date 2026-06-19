"use client";

// src/components/liff/FaqRenderer.tsx
// LIFF FAQ モード — Q&A をアコーディオン形式で並べる。
// 空項目（question / answer どちらも空）はスキップする。

import { useEffect, useState } from "react";
import type { FaqItem, LiffPageConfigSettings } from "@/types";
import { recordLiffEvent } from "@/lib/liff-events";
import { useLiffPlayerContext } from "./LiffPlayerContext";
import { liffRootClass } from "./liff-style-helpers";
import { visibleFaqItems } from "./faq-helpers";
import { resolveFaqContactHref } from "./faq-contact-cta";

export interface FaqRendererConfig {
  /** 作品名。ヘッダーに表示する (新仕様)。未指定なら title にフォールバック */
  work_title?:   string | null;
  /** LIFF ページ名。本文側 h1 で表示する */
  title:         string | null;
  description:   string | null;
  settings_json: LiffPageConfigSettings;
}

export function FaqRenderer({ config, preview }: { config: FaqRendererConfig; preview?: boolean }) {
  // 表示対象の FAQ 項目（空項目除外・未設定セーフ）は純ヘルパーに集約。
  const items = visibleFaqItems(config.settings_json.faq_items);

  // お問い合わせ CTA のリンク先（同 work に公開中 & 有効な contact ページがある場合のみ）。
  // 実機（player context に workId あり・preview でない）でのみメニュー API を引き、
  // 公開済み contact ページを探す。見つからなければ静的案内のまま（404/500 を誘発しない）。
  const playerCtx = useLiffPlayerContext();
  const [contactHref, setContactHref] = useState<string | null>(null);
  const ctxWorkId = playerCtx?.workId;
  useEffect(() => {
    if (preview || !ctxWorkId) return; // preview / workId 無しは静的 CTA
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/liff/works/${ctxWorkId}/menu`);
        const json = await res.json();
        if (cancelled || !json?.success || !Array.isArray(json?.data?.pages)) return;
        setContactHref(resolveFaqContactHref(json.data.pages, ctxWorkId));
      } catch {
        // 失敗時は静的 CTA のまま
      }
    })();
    return () => { cancelled = true; };
  }, [preview, ctxWorkId]);

  return (
    <div className={`liff-font ${liffRootClass(config.settings_json)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
      {/* 画面内ヘッダーは廃止。document.title (= LIFF 上部バー) で文脈表現する。 */}
      <main className="liff-player-main pt-5 pb-24 flex flex-col gap-4">
        {/* 説明文（config.description）は LiffSinglePageRenderer のページ見出し側で 1 度だけ表示する。
            ここで再表示すると二重になるため出さない（document.title は LINE 上部バー）。 */}
        {items.length === 0 ? (
          <p className="text-sm text-[color:var(--liff-tertiary-text)] text-center py-8">
            （Q&amp;A が登録されていません）
          </p>
        ) : (
          // FAQ リスト = 1 枚の白カード（radius 10 / 薄影 / overflow hidden）。
          // 各 Q&A は個別カードにせず、薄い区切り線で 1 枚のカード内に並べる。
          <ul className="bg-[color:var(--liff-surface,#fff)] rounded-[10px] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
            {items.map((item, idx) => (
              <FaqRow key={item.id ?? idx} item={item} index={idx} isLast={idx === items.length - 1} />
            ))}
          </ul>
        )}

        {/* お問い合わせ導線（見た目だけ中央寄せテキストリンクに変更）。リンク先 contactHref の解決・
            表示条件は従来どおり（公開中 & 有効な contact ページがある場合のみリンク化）。導線ロジック不変。 */}
        {contactHref ? (
          <a
            href={contactHref}
            aria-label="お問い合わせ"
            className="mt-3 block text-center text-[12.5px] text-[color:var(--liff-tertiary-text,#777)] active:opacity-70"
          >
            お問い合わせ ›
          </a>
        ) : (
          <p className="mt-3 text-center text-[12.5px] text-[color:var(--liff-tertiary-text,#777)]">
            お問い合わせフォームは今後追加予定です。
          </p>
        )}
      </main>
    </div>
  );
}

function FaqRow({ item, index, isLast }: { item: FaqItem; index: number; isLast: boolean }) {
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
    <li className={isLast ? "" : "border-b border-[color:var(--liff-border)]"}>
      <button
        id={headerId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="w-full flex items-center gap-3 text-left px-4 py-4 transition-colors active:bg-[color:var(--liff-surface-subtle,#F5F5F5)]"
      >
        {/* Q バッジ: 淡い LINE グリーン背景 + 濃いグリーン文字（--liff-ui-* token）。 */}
        <span
          aria-hidden="true"
          className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-[13px] font-bold bg-[color:var(--liff-ui-green-soft,#E8F9EE)] text-[color:var(--liff-ui-green-pressed,#06A047)]"
        >
          Q
        </span>
        <span className="flex-1 min-w-0 font-normal text-[14px] leading-snug break-words text-[color:var(--liff-primary-text)]">
          {item.question?.trim() || "（質問未設定）"}
        </span>
        {/* AccordionBlock と同じ chevron。緑ボタン / 丸枠は使わない */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-[color:var(--liff-tertiary-text)] transition-transform ${
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
          className="pl-[52px] pr-4 pb-[17px]"
        >
          <p className="text-[13px] leading-[1.85] whitespace-pre-wrap break-words text-[color:var(--liff-secondary-text)]">
            {item.answer?.trim() || "（回答未設定）"}
          </p>
        </div>
      )}
    </li>
  );
}
