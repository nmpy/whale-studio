"use client";

// src/components/destination/DestinationUrlPreview.tsx
// フォーム入力値からリアルタイムで resolved URL を表示するプレビュー。
// 保存前に最終URLを確認できる。

import { resolveDestinationUrl } from "@/lib/destination-url-builder";
import type { DestinationType, LiffTargetType } from "@/types";

interface Props {
  workId: string;
  destinationType: DestinationType;
  liffTargetType?: LiffTargetType | null;
  urlOrPath?: string | null;
  queryParams: Record<string, string>;
}

export function DestinationUrlPreview({
  workId, destinationType, liffTargetType, urlOrPath, queryParams,
}: Props) {
  // 空キーを除外してURL生成
  const cleanParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(queryParams)) {
    if (k.trim()) cleanParams[k.trim()] = v;
  }

  const resolved = resolveDestinationUrl({
    destinationType,
    liffTargetType,
    urlOrPath,
    queryParamsJson: cleanParams,
    workId,
  });

  if (!resolved) {
    const reason = destinationType === "liff"
      ? "NEXT_PUBLIC_LIFF_ID が未設定です"
      : destinationType === "internal_url"
      ? "パスを入力してください"
      : "URLを入力してください";

    return (
      <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-xs font-medium text-amber-600 mb-0.5">生成されるURL</p>
        <p className="text-xs text-amber-500">{reason}</p>
      </div>
    );
  }

  return (
    <div className="mt-4 p-3 bg-teal-50 border border-teal-200 rounded-lg">
      <p className="text-xs font-medium text-teal-700 mb-1">生成されるURL</p>
      <code className="text-[11px] text-teal-800 break-all leading-relaxed">{resolved}</code>
    </div>
  );
}
