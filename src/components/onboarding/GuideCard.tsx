"use client";

interface Props {
  icon?:    string;
  message:  string;
  ctaText?: string;
  ctaHref?: string;
}

/**
 * GuideCard — 各画面の初回向けインラインガイドバナー
 *
 * 使い方:
 *   !loading && items.length === 0 のときに表示する。
 *   HelpAccordion の上に置く（コンテンツエリアの最上部）。
 */
export function GuideCard({ icon = "💡", message, ctaText, ctaHref }: Props) {
  return (
    <div
      className="flex items-start rounded-2xl border border-sky-200 bg-sky-50"
      style={{ gap: 10, padding: "11px 16px", marginBottom: 16 }}
    >
      <span className="flex-shrink-0" style={{ fontSize: 15, marginTop: 1 }}>{icon}</span>
      <p className="text-sky-700 leading-relaxed flex-1" style={{ fontSize: 12, margin: 0 }}>
        {message}
      </p>
      {ctaText && ctaHref && (
        <a
          href={ctaHref}
          className="flex-shrink-0 font-semibold text-sky-600 hover:text-sky-800 underline"
          style={{ fontSize: 12, marginLeft: 4 }}
        >
          {ctaText}
        </a>
      )}
    </div>
  );
}
