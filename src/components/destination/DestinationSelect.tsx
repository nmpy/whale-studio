"use client";

// src/components/destination/DestinationSelect.tsx
// 再利用可能な destination セレクトコンポーネント。
// メッセージ編集・リッチメニュー編集など複数画面から使い回せる。

import { useEffect, useState } from "react";
import { destinationApi, getDevToken } from "@/lib/api-client";
import { resolveDestinationUrlFromApi } from "@/lib/destination-url-builder";
import type { LineDestination, DestinationType } from "@/types";

const TYPE_LABELS: Record<DestinationType, string> = {
  liff:         "LIFF",
  internal_url: "内部",
  external_url: "外部",
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

  if (loading) {
    return <div className="h-9 bg-gray-100 rounded-lg animate-pulse" />;
  }

  return (
    <div className="space-y-2">
      {enabledDests.length === 0 ? (
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 text-center">
          <p className="text-xs text-gray-500 mb-1">遷移先が登録されていません</p>
          {oaId && (
            <a
              href={`/oas/${oaId}/works/${workId}/destinations`}
              className="text-xs text-teal-600 hover:text-teal-800 underline"
              target="_blank"
              rel="noopener"
            >
              遷移先URL設定を開く
            </a>
          )}
        </div>
      ) : (
        <>
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

          {/* 選択中の resolved URL 補助表示 */}
          {selected && resolvedUrl && (
            <p className="text-[11px] text-gray-500 truncate" title={resolvedUrl}>
              実際のURL: {resolvedUrl}
            </p>
          )}

          {oaId && (
            <a
              href={`/oas/${oaId}/works/${workId}/destinations`}
              className="text-[11px] text-teal-600 hover:text-teal-800"
              target="_blank"
              rel="noopener"
            >
              遷移先URL設定を開く →
            </a>
          )}
        </>
      )}
    </div>
  );
}
