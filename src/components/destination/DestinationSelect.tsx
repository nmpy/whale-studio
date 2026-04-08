"use client";

// src/components/destination/DestinationSelect.tsx
// 再利用可能な destination セレクトコンポーネント。
// メッセージ編集・リッチメニュー編集など複数画面から使い回せる。
// 空状態・選択中の補助情報・管理画面リンクを統一的に提供する。

import { useEffect, useState } from "react";
import { destinationApi, getDevToken } from "@/lib/api-client";
import { resolveDestinationUrlFromApi } from "@/lib/destination-url-builder";
import type { LineDestination, DestinationType } from "@/types";

const TYPE_LABELS: Record<DestinationType, string> = {
  liff:         "LIFF",
  internal_url: "内部URL",
  external_url: "外部URL",
};

interface Props {
  workId: string;
  value: string | null;
  onChange: (destinationId: string | null, destination: LineDestination | null) => void;
  disabled?: boolean;
  /** destination 一覧を外部から注入する場合（重複フェッチ防止） */
  destinations?: LineDestination[];
  /** 遷移先URL設定ページへのリンク用（OA ID） */
  oaId?: string;
}

export function DestinationSelect({ workId, value, onChange, disabled, destinations: externalDests, oaId }: Props) {
  const [internalDests, setInternalDests] = useState<LineDestination[]>([]);
  const [loading, setLoading] = useState(!externalDests);

  const destinations = externalDests ?? internalDests;

  useEffect(() => {
    if (externalDests) return;
    const token = getDevToken();
    destinationApi.list(token, workId)
      .then(setInternalDests)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workId, externalDests]);

  const selected = value ? destinations.find((d) => d.id === value) : null;
  const enabledDests = destinations.filter((d) => d.is_enabled);
  const resolvedUrl = selected ? (selected.resolved_url ?? resolveDestinationUrlFromApi(selected)) : null;

  const manageLink = oaId ? `/oas/${oaId}/works/${workId}/destinations` : null;

  if (loading) {
    return <div className="h-9 bg-gray-100 rounded-lg animate-pulse" />;
  }

  // ── 空状態: destination が未作成 ──
  if (enabledDests.length === 0) {
    return (
      <div className="p-4 bg-teal-50 rounded-lg border border-teal-100 text-center">
        <p className="text-xs font-medium text-teal-700 mb-1">
          保存済みの遷移先がまだありません
        </p>
        <p className="text-[11px] text-teal-600 mb-2">
          「遷移先URL設定」で作成すると、他の画面でも再利用できます
        </p>
        {manageLink && (
          <a
            href={manageLink}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 bg-white px-3 py-1.5 rounded-md border border-teal-200 hover:bg-teal-50 transition-colors"
            target="_blank"
            rel="noopener"
          >
            + 遷移先URL設定を開く
          </a>
        )}
      </div>
    );
  }

  // ── 通常表示 ──
  return (
    <div className="space-y-2">
      <select
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-200 disabled:bg-gray-50 disabled:text-gray-500"
        value={value ?? ""}
        onChange={(e) => {
          const id = e.target.value || null;
          const dest = id ? destinations.find((d) => d.id === id) ?? null : null;
          onChange(id, dest);
        }}
        disabled={disabled}
      >
        <option value="">遷移先を選択...</option>
        {enabledDests.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} ({d.key}) — {TYPE_LABELS[d.destination_type] ?? d.destination_type}
          </option>
        ))}
      </select>

      {/* 選択中の補助情報 */}
      {selected && (
        <div className="px-2.5 py-2 bg-gray-50 rounded-md border border-gray-100">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[11px] font-medium text-gray-700">{selected.name}</span>
            <code className="text-[10px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded">{selected.key}</code>
            <span className={`text-[10px] px-1 py-0.5 rounded-full font-medium ${
              selected.destination_type === "liff" ? "bg-violet-100 text-violet-700" :
              selected.destination_type === "internal_url" ? "bg-blue-100 text-blue-700" :
              "bg-green-100 text-green-700"
            }`}>{TYPE_LABELS[selected.destination_type]}</span>
            {selected.usage_count != null && selected.usage_count > 0 && (
              <span className="text-[10px] text-teal-600">使用中 {selected.usage_count}件</span>
            )}
          </div>
          {resolvedUrl && (
            <p className="text-[10px] text-gray-400 truncate" title={resolvedUrl}>
              {resolvedUrl}
            </p>
          )}
        </div>
      )}

      {/* 管理画面リンク */}
      {manageLink && (
        <a
          href={manageLink}
          className="inline-flex items-center gap-1 text-[11px] text-teal-600 hover:text-teal-800"
          target="_blank"
          rel="noopener"
        >
          遷移先URL設定を開く →
        </a>
      )}
    </div>
  );
}
