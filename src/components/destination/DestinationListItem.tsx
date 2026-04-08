"use client";

// src/components/destination/DestinationListItem.tsx
// destination 一覧の個別カード。resolved URL 表示 + コピー + 編集/削除。

import { useState } from "react";
import { resolveDestinationUrlFromApi } from "@/lib/destination-url-builder";
import type { LineDestination, DestinationType } from "@/types";

const TYPE_LABELS: Record<DestinationType, string> = {
  liff:         "LIFF",
  internal_url: "内部URL",
  external_url: "外部URL",
};

const TYPE_STYLES: Record<DestinationType, string> = {
  liff:         "bg-violet-100 text-violet-700",
  internal_url: "bg-blue-100 text-blue-700",
  external_url: "bg-green-100 text-green-700",
};

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
      className={`bg-white rounded-lg border p-4 transition-opacity ${
        d.is_enabled ? "border-gray-200" : "border-gray-100 opacity-50"
      }`}
    >
      {/* 上段: name + badges */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm font-semibold text-gray-900">{d.name}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
          TYPE_STYLES[d.destination_type] ?? "bg-gray-100 text-gray-600"
        }`}>
          {TYPE_LABELS[d.destination_type] ?? d.destination_type}
        </span>
        {!d.is_enabled && (
          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">無効</span>
        )}
      </div>

      {/* 中段: key + target */}
      <div className="flex items-center gap-3 text-[11px] text-gray-500 mb-2">
        <code className="bg-gray-50 px-1.5 py-0.5 rounded text-gray-600">{d.key}</code>
        {d.destination_type === "liff" && d.liff_target_type && (
          <span>target: {d.liff_target_type}</span>
        )}
        {d.description && (
          <span className="truncate max-w-[200px]" title={d.description}>{d.description}</span>
        )}
      </div>

      {/* 下段: resolved URL + copy */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {resolved ? (
            <>
              <code className="text-[11px] text-gray-500 bg-gray-50 px-2 py-1 rounded truncate block min-w-0 flex-1" title={resolved}>
                {resolved}
              </code>
              <button
                onClick={handleCopy}
                className={`shrink-0 text-[11px] px-2.5 py-1 rounded border cursor-pointer transition-colors ${
                  copied
                    ? "bg-green-50 border-green-200 text-green-600"
                    : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}
              >
                {copied ? "✓ コピー済" : "コピー"}
              </button>
            </>
          ) : (
            <p className="text-[11px] text-amber-500">
              URLを生成できません（環境変数を確認してください）
            </p>
          )}
        </div>

        {/* 操作ボタン */}
        {!readOnly && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={onToggleEnabled}
              className={`px-2 py-1 text-[11px] border border-gray-200 rounded-md bg-white cursor-pointer ${
                d.is_enabled ? "text-green-600" : "text-gray-400"
              }`}
            >
              {d.is_enabled ? "ON" : "OFF"}
            </button>
            <button
              onClick={onEdit}
              className="px-2.5 py-1 text-[11px] border border-gray-200 rounded-md bg-white text-gray-600 cursor-pointer hover:bg-gray-50"
            >
              編集
            </button>
            <button
              onClick={onDelete}
              className="px-2.5 py-1 text-[11px] border border-red-100 rounded-md bg-white text-red-500 cursor-pointer hover:bg-red-50"
            >
              削除
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
