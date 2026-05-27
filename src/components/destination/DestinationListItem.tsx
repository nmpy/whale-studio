"use client";

// src/components/destination/DestinationListItem.tsx
// destination 一覧の個別カード。resolved URL 表示 + コピー + 編集/削除。
//
// Phase 4.2b: UI を Phase 0 トークン + shared/Button に揃える。
// useDestinations / destinationApi / destinations/page.tsx / DestinationFormModal /
// resolveDestinationUrlFromApi 本体には触らない。
// props signature / handleCopy / clipboard / setCopied / 2s リセット /
// onEdit / onDelete / onToggleEnabled / readOnly 制御 / TYPE_LABELS 文言 /
// 「無効」「使用中 N件」「未使用」「✓ コピー済」「コピー」「ON」「OFF」「編集」「削除」
// 「target:」「URLを生成できません（環境変数を確認してください）」表示条件は完全維持。

import { useState } from "react";
import { resolveDestinationUrlFromApi } from "@/lib/destination-url-builder";
import { Button } from "@/components/shared";
import type { LineDestination, DestinationType } from "@/types";

const TYPE_LABELS: Record<DestinationType, string> = {
  liff:         "LIFF",
  internal_url: "内部URL",
  external_url: "外部URL",
};

// 種別アイデンティティ系 (= lilac / sky / brand トークン)。
// shared/StatusBadge は使わない (= サイズ密度を一覧最適化のため inline)。
const TYPE_STYLES: Record<DestinationType, string> = {
  liff:         "bg-lilac-soft text-lilac border border-lilac/30",
  internal_url: "bg-sky-soft text-sky-ink border border-sky/30",
  external_url: "bg-brand-soft text-brand-ink border border-brand/30",
};

const TYPE_FALLBACK = "bg-line-2 text-ink-3 border border-line";

interface Props {
  destination: LineDestination;
  readOnly: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
}

export function DestinationListItem({ destination: d, readOnly, onEdit, onDelete, onToggleEnabled }: Props) {
  const [copied, setCopied] = useState(false);
  const resolved = d.resolved_url ?? resolveDestinationUrlFromApi(d);

  const handleCopy = async () => {
    if (!resolved) return;
    try {
      await navigator.clipboard.writeText(resolved);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: 選択させる
    }
  };

  return (
    <div
      className={
        "rounded-card border bg-surface p-4 shadow-sm transition-all " +
        "hover:border-brand/30 " +
        (d.is_enabled ? "border-line" : "border-line-2 opacity-50")
      }
    >
      {/* 上段: name + badges */}
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-ink">{d.name}</span>
        <span
          className={
            "rounded-full px-1.5 py-0.5 text-[10px] font-medium " +
            (TYPE_STYLES[d.destination_type] ?? TYPE_FALLBACK)
          }
        >
          {TYPE_LABELS[d.destination_type] ?? d.destination_type}
        </span>
        {!d.is_enabled && (
          <span className="rounded-full bg-line-2 px-1.5 py-0.5 text-[10px] text-ink-3">無効</span>
        )}
        {d.usage_count != null && d.usage_count > 0 && (
          <span className="rounded-full bg-sky-soft px-1.5 py-0.5 text-[10px] text-sky-ink">
            使用中 {d.usage_count}件
          </span>
        )}
        {d.usage_count === 0 && (
          <span className="rounded-full border border-line bg-bg-tint px-1.5 py-0.5 text-[10px] text-ink-3">
            未使用
          </span>
        )}
      </div>

      {/* 中段: key + target */}
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
        <code className="rounded border border-line bg-bg-tint px-1.5 py-0.5 font-mono text-ink-2">
          {d.key}
        </code>
        {d.destination_type === "liff" && d.liff_target_type && (
          <span>target: {d.liff_target_type}</span>
        )}
        {d.description && (
          <span className="max-w-[200px] truncate" title={d.description}>{d.description}</span>
        )}
      </div>

      {/* 下段: resolved URL + copy + 操作ボタン (= 既存レイアウト維持) */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {resolved ? (
            <>
              <code
                className="block min-w-0 flex-1 truncate rounded border border-line bg-bg-tint px-2 py-1 font-mono text-[11px] text-ink-2"
                title={resolved}
              >
                {resolved}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className={
                  "shrink-0 rounded-md border px-2.5 py-1 text-[11px] transition-colors " +
                  (copied
                    ? "border-brand/30 bg-brand-soft text-brand-ink"
                    : "border-line bg-surface text-ink-2 hover:bg-bg-tint")
                }
              >
                {copied ? "✓ コピー済" : "コピー"}
              </button>
            </>
          ) : (
            <p className="text-[11px] text-warn">
              URLを生成できません（環境変数を確認してください）
            </p>
          )}
        </div>

        {/* 操作ボタン */}
        {!readOnly && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={onToggleEnabled}
              className={
                "rounded-md border border-line bg-surface px-2 py-1 text-[11px] transition-colors hover:bg-bg-tint " +
                (d.is_enabled ? "text-brand-ink" : "text-ink-3")
              }
            >
              {d.is_enabled ? "ON" : "OFF"}
            </button>
            <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
              編集
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={onDelete}>
              削除
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
