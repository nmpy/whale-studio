"use client";

// src/components/liff/FaqRenderer.tsx
// LIFF FAQ モード — Q&A をアコーディオン形式で並べる。
// 空項目（question / answer どちらも空）はスキップする。

import { useEffect, useState } from "react";
import type { FaqItem, LiffPageConfigSettings } from "@/types";
import { recordLiffEvent } from "@/lib/liff-events";
import { useLiffPlayerContext } from "./LiffPlayerContext";
import { liffRootClass, liffDescriptionAlignClass } from "./liff-style-helpers";
import { visibleFaqItems } from "./faq-helpers";
import { resolveFaqContactHref } from "./faq-contact-cta";
import { LiffCard } from "./primitives";

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
        {/* ページタイトル h2 は廃止。ヘッダーの header_title (またはフォールバック) で文脈表現。
            description だけは本文先頭に残す (CMS で設定がある場合のみ表示)。 */}
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

        {/* お問い合わせ導線。同 work に公開中 & 有効な contact ページがあればリンク化、
            無ければ静的案内のまま（404 / 500 を誘発しない）。 */}
        {contactHref ? (
          <LiffCard as="a" href={contactHref} padding="md" className="mt-2" aria-label="お問い合わせ">
            <p className="text-[12px] font-bold text-[color:var(--liff-secondary-text)]">解決しない場合</p>
            <p className="mt-1 text-[15px] font-bold text-[color:var(--liff-primary-text)]">お問い合わせ</p>
            <p className="mt-1 text-[13px] leading-[1.6] text-[color:var(--liff-tertiary-text)]">
              お問い合わせフォームへ進む
            </p>
          </LiffCard>
        ) : (
          <LiffCard padding="md" className="mt-2">
            <p className="text-[12px] font-bold text-[color:var(--liff-secondary-text)]">解決しない場合</p>
            <p className="mt-1 text-[15px] font-bold text-[color:var(--liff-primary-text)]">お問い合わせ</p>
            <p className="mt-1 text-[13px] leading-[1.6] text-[color:var(--liff-tertiary-text)]">
              お問い合わせフォームは今後追加予定です。
            </p>
          </LiffCard>
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
    <li className="border border-[color:var(--liff-border)] rounded-[18px] shadow-[0_2px_10px_rgba(31,64,92,0.05)] overflow-hidden bg-[color:var(--liff-surface)]">
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
