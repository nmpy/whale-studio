"use client";

// src/app/oas/[id]/works/[workId]/liff/_PageListTab.tsx
//
// 「詳細ページ」「独立ページ」タブで共用する LIFF ページ一覧。
// 表示対象 (pages) は呼び出し側で show_in_menu によって振り分け済みのものを渡す。
// 旧 liff/page.tsx の <li> 行レンダリングをそのまま関数化したもの（UI 不変）。

import { buttonClass } from "@/components/shared";
import type { LiffPageSummary, LiffPageAnalyticsSummaryRow } from "@/lib/api-client";
import {
  PUBLISH_LABELS,
  PAGE_TYPE_LABELS,
  METRIC_LABELS,
  formatPercent,
  formatCount,
  formatDateTime,
  buildPublicUrl,
} from "./_shared";

interface Props {
  oaId: string;
  workId: string;
  pages: LiffPageSummary[];
  isReadOnly: boolean;
  creating: boolean;
  copied: string | null;
  analytics: Record<string, LiffPageAnalyticsSummaryRow> | null;
  onCreate: () => void;
  onCopyUrl: (pageId: string) => void;
  emptyTitle: string;
  emptyDescription: string;
}

export function PageListTab({
  oaId, workId, pages, isReadOnly, creating, copied, analytics,
  onCreate, onCopyUrl, emptyTitle, emptyDescription,
}: Props) {
  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        {!isReadOnly && (
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            aria-busy={creating || undefined}
            className={buttonClass({ variant: "primary", size: "md" })}
          >
            {creating && <span className="spinner" aria-hidden="true" />}
            {creating ? "作成中..." : "＋ LIFFページを作成"}
          </button>
        )}
      </div>

      {pages.length === 0 ? (
        <div className="bg-gray-50 rounded-xl p-10 text-center border-2 border-dashed border-gray-200">
          <p className="text-sm text-gray-500 mb-2">{emptyTitle}</p>
          <p className="text-xs text-gray-400">{emptyDescription}</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {pages.map((p) => {
              const url = buildPublicUrl({
                workId,
                workPublicId: p.work_public_id,
                pageId: p.id,
                pagePublicId: p.public_id,
              });
              return (
                <li key={p.id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[15px] font-bold text-gray-900 truncate">
                        {p.title?.trim() || "（無題）"}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-600">
                        {PAGE_TYPE_LABELS[p.page_type] ?? p.page_type}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          p.publish_status === "published"
                            ? "bg-green-50 text-green-700 border border-green-200"
                            : p.publish_status === "archived"
                              ? "bg-gray-100 text-gray-500 border border-gray-200"
                              : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}
                      >
                        {PUBLISH_LABELS[p.publish_status] ?? p.publish_status}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5 items-center">
                      <span>作成: {formatDateTime(p.created_at)}</span>
                      <span>更新: {formatDateTime(p.updated_at)}</span>
                      {(p.submission_count ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-soft text-brand-ink border border-brand/30">
                          回答 {p.submission_count}
                        </span>
                      )}
                    </div>
                    {/* KPI 行 — 計測 API 取得後に表示。失敗時は "-" にフォールバック */}
                    {analytics && (
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-600">
                        <span title="ページ表示回数">
                          PV: <strong className="text-gray-900">{formatCount(analytics[p.id]?.page_view ?? 0)}</strong>
                        </span>
                        <span title="ユニークユーザー数">
                          UU: <strong className="text-gray-900">{formatCount(analytics[p.id]?.unique_users ?? 0)}</strong>
                        </span>
                        <span title="ボタンクリック数 / PV">
                          CTR: <strong className="text-gray-900">{formatPercent(analytics[p.id]?.ctr ?? 0)}</strong>
                        </span>
                        {analytics[p.id]?.page_type_metric_key && (
                          <span title={METRIC_LABELS[analytics[p.id].page_type_metric_key!] ?? analytics[p.id].page_type_metric_key!}>
                            {METRIC_LABELS[analytics[p.id].page_type_metric_key!] ?? analytics[p.id].page_type_metric_key}:{" "}
                            <strong className="text-gray-900">{formatCount(analytics[p.id]?.page_type_metric_count ?? 0)}</strong>
                          </span>
                        )}
                      </div>
                    )}
                    {url && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-brand-ink underline truncate max-w-full"
                          title={url}
                        >
                          {url}
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {url && (
                      <button
                        type="button"
                        onClick={() => onCopyUrl(p.id)}
                        className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-md text-xs hover:bg-gray-50"
                        title="URL をコピー"
                      >
                        {copied === p.id ? "コピーしました!" : "URLコピー"}
                      </button>
                    )}
                    <a
                      href={`/oas/${oaId}/works/${workId}/liff/pages/${p.id}/submissions`}
                      className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-md text-xs hover:bg-gray-50"
                      title="回答結果を見る"
                    >
                      回答を見る
                    </a>
                    <a
                      href={`/oas/${oaId}/works/${workId}/liff/${p.id}`}
                      className={buttonClass({ variant: "primary", size: "sm" })}
                    >
                      編集
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
