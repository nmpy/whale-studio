"use client";

// src/components/PlanInfoAccordion.tsx
// アカウント設定画面の「プラン・利用条件」アコーディオン（補助情報エリア）。
//
// 方針:
//   - 売り込み感を出さない。大きな CTA / 「いますぐアップグレード」等は使わない。
//   - デフォルト閉じ。開いたときだけ落ち着いた説明文 + 控えめな text link を表示。
//   - 設定画面のトーン（rounded-card / border-line / bg-surface / ink-*）に合わせる。
//   - リンク先は既存のプラン導線（buildPricingUrl）。oa_id / source トラッキングを保持。
//   - プラン判定・課金・API には一切触れない（表示導線のみ）。

import { useState } from "react";
import Link from "next/link";
import { buildPricingUrl } from "@/lib/pricing-url";

export function PlanInfoAccordion({
  oaId,
  children,
}: {
  oaId: string;
  /** 開いたときに説明文の上へ表示する現在プラン情報（例: 埋め込み PlanCard）。 */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false); // デフォルト閉じ

  return (
    <section className="mb-5">
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left"
        >
          <span className="flex-1 text-[13px] font-semibold text-ink-2">
            プラン・利用条件
          </span>
          <span
            aria-hidden="true"
            className={
              "flex-shrink-0 text-[10px] text-ink-3 transition-transform duration-200 " +
              (open ? "rotate-180" : "")
            }
          >
            ▼
          </span>
        </button>

        {open && (
          <div className="border-t border-line px-4 py-3.5">
            {/* 現在のご利用プラン（embedded PlanCard 等）。閉じている間はマウントされない。 */}
            {children && (
              <div className="mb-3.5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                  現在のご利用プラン
                </p>
                {children}
              </div>
            )}
            <p className="mb-3 text-[12px] leading-[1.7] text-ink-2">
              現在利用できる機能やプランごとの条件を確認できます。
              <br />
              必要に応じて、料金・プランページで詳細をご確認ください。
            </p>
            <Link
              href={buildPricingUrl({ source: "settings", oaId })}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-ink no-underline transition-colors hover:underline"
            >
              料金・プランを確認する
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
