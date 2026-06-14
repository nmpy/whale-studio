"use client";

// src/app/oas/[id]/works/[workId]/liff/_AnalyticsTab.tsx
//
// 「計測」タブ — 既存の getAnalyticsSummary（page ごとの PV/UU/CTR/種別指標）を表で表示する。
// 計測データがまだ無い（取得失敗 or 0 件）場合は準備中の空状態を出す（新規計測ロジックは実装しない）。

import type { LiffPageSummary, LiffPageAnalyticsSummaryRow } from "@/lib/api-client";
import { METRIC_LABELS, formatPercent, formatCount } from "./_shared";

interface Props {
  pages: LiffPageSummary[];
  /** page_id -> 集計値。null = 取得中、{} = データ無し（"-" 表示 / 空状態） */
  analytics: Record<string, LiffPageAnalyticsSummaryRow> | null;
}

export function AnalyticsTab({ pages, analytics }: Props) {
  // 取得中
  if (analytics === null) {
    return <div className="h-32 bg-gray-100 rounded-lg animate-pulse" />;
  }

  const hasData = Object.keys(analytics).length > 0 && pages.length > 0;

  if (!hasData) {
    return (
      <div className="bg-gray-50 rounded-xl p-10 text-center border-2 border-dashed border-gray-200">
        <h2 className="text-base font-semibold text-gray-700 mb-2">計測</h2>
        <p className="text-sm text-gray-500 mb-1">LIFFページの閲覧数や利用状況を確認できる機能です。</p>
        <p className="text-xs text-gray-400">現在、計測データの表示は準備中です。</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-[11px] text-gray-500">
            <th className="px-4 py-2.5 font-medium">ページ</th>
            <th className="px-4 py-2.5 font-medium text-right" title="ページ表示回数">PV</th>
            <th className="px-4 py-2.5 font-medium text-right" title="ユニークユーザー数">UU</th>
            <th className="px-4 py-2.5 font-medium text-right" title="ボタンクリック数 / PV">CTR</th>
            <th className="px-4 py-2.5 font-medium text-right">種別指標</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {pages.map((p) => {
            const row = analytics[p.id];
            const metricKey = row?.page_type_metric_key;
            return (
              <tr key={p.id} className="text-gray-700">
                <td className="px-4 py-2.5">
                  <span className="font-semibold text-gray-900">{p.title?.trim() || "（無題）"}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(row?.page_view ?? 0)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(row?.unique_users ?? 0)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatPercent(row?.ctr ?? 0)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {metricKey ? (
                    <span title={METRIC_LABELS[metricKey] ?? metricKey}>
                      <span className="text-[11px] text-gray-400 mr-1">{METRIC_LABELS[metricKey] ?? metricKey}</span>
                      {formatCount(row?.page_type_metric_count ?? 0)}
                    </span>
                  ) : (
                    <span className="text-gray-300">-</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
