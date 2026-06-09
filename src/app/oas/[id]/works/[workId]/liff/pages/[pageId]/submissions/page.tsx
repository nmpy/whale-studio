"use client";

// src/app/oas/[id]/works/[workId]/liff/pages/[pageId]/submissions/page.tsx
// LIFF「回答結果」画面 — フォーム/アンケート送信（LiffSubmission）の確認・集計・CSV出力。

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { getAuthHeaders } from "@/lib/api-client";
import {
  aggregateByQuestion, answerValueToText,
  type SubmissionRow, type SubmissionAnswerBlock,
} from "@/lib/liff/submission";

interface SubmissionDto {
  id: string;
  line_user_id: string | null;
  display_name: string | null;
  created_at: string;
  blocks: SubmissionAnswerBlock[];
}
interface ResultsDto {
  page: { id: string; public_id?: string; title: string | null };
  total: number;
  today: number;
  last_7d: number;
  last_at: string | null;
  submissions: SubmissionDto[];
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function LiffSubmissionsPage() {
  const params = useParams<{ id: string; workId: string; pageId: string }>();
  const { id: oaId, workId, pageId } = params;

  const [data, setData] = useState<ResultsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const apiBase = `/api/oas/${oaId}/works/${workId}/liff/pages/${pageId}/submissions`;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(apiBase, { headers: { ...getAuthHeaders() }, cache: "no-store" });
      if (!res.ok) {
        if (res.status === 403) throw new Error("この回答結果を表示する権限がありません。");
        if (res.status === 404) throw new Error("ページが見つかりませんでした。");
        throw new Error("読み込みに失敗しました。");
      }
      const json = await res.json();
      setData(json.data as ResultsDto);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { void load(); }, [load]);

  const rows: SubmissionRow[] = useMemo(
    () => (data?.submissions ?? []).map((s) => ({
      lineUserId: s.line_user_id, displayName: s.display_name, createdAt: s.created_at, blocks: s.blocks,
    })),
    [data],
  );
  const aggregations = useMemo(() => aggregateByQuestion(rows), [rows]);

  const handleDownloadCsv = useCallback(async () => {
    setDownloading(true);
    try {
      const res = await fetch(`${apiBase}.csv`, { headers: { ...getAuthHeaders() }, cache: "no-store" });
      if (!res.ok) throw new Error("CSV のダウンロードに失敗しました。");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      a.download = m ? decodeURIComponent(m[1]) : "liff-submissions.csv";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("CSV のダウンロードに失敗しました。時間をおいて再度お試しください。");
    } finally {
      setDownloading(false);
    }
  }, [apiBase]);

  const editHref = `/oas/${oaId}/works/${workId}/liff/${pageId}`;
  const title = data?.page.title || "LIFFページ";

  return (
    <div className="px-4 sm:px-6 pb-10 max-w-5xl mx-auto">
      <Breadcrumb
        items={[
          { label: "作品一覧", href: `/oas/${oaId}/works` },
          { label: "LIFF表示設定", href: `/oas/${oaId}/works/${workId}/liff` },
          { label: "回答結果" },
        ]}
      />

      {/* ヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mt-3 mb-5">
        <div>
          <h1 className="text-lg font-bold text-gray-900">回答結果</h1>
          <p className="text-sm text-gray-500 mt-0.5">{title}</p>
          {data && (
            <p className="text-xs text-gray-400 mt-1">
              回答数 {data.total} 件 / 最終回答 {fmtDateTime(data.last_at)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href={editHref} className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            LIFFページ編集へ戻る
          </Link>
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={downloading || !data || data.total === 0}
            className="px-4 py-2 text-sm font-bold text-white rounded-full bg-brand hover:bg-brand-deep disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloading ? "出力中…" : "CSVダウンロード"}
          </button>
        </div>
      </div>

      {loading && <div className="text-center text-gray-500 py-16 text-sm">読み込み中...</div>}

      {!loading && error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
          {error}
          <button onClick={load} className="ml-3 underline">再読み込み</button>
        </div>
      )}

      {!loading && !error && data && data.total === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
          <p className="text-base font-bold text-gray-900">まだ回答はありません</p>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed max-w-md mx-auto">
            この LIFF ページでユーザーがフォームやアンケートを送信すると、ここに結果が表示されます。
          </p>
          <Link href={editHref} className="inline-block mt-5 px-4 py-2 text-sm font-bold text-white rounded-full bg-brand hover:bg-brand-deep">
            LIFFページを確認する
          </Link>
        </div>
      )}

      {!loading && !error && data && data.total > 0 && (
        <div className="space-y-6">
          {/* サマリーカード */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="総回答数" value={`${data.total}`} />
            <SummaryCard label="今日の回答" value={`${data.today}`} />
            <SummaryCard label="直近7日" value={`${data.last_7d}`} />
            <SummaryCard label="最終回答" value={fmtDateTime(data.last_at)} small />
          </div>

          {/* 設問別集計 */}
          <section>
            <h2 className="text-sm font-bold text-gray-900 mb-3">設問別集計</h2>
            <div className="space-y-4">
              {aggregations.map((agg) => (
                <div key={agg.blockId || agg.label} className="border border-gray-200 rounded-xl p-4 bg-white">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-sm font-bold text-gray-900">{agg.label}</span>
                    <span className="text-xs text-gray-400 shrink-0">{agg.responseCount} 件回答</span>
                  </div>
                  {agg.choices ? (
                    <div className="space-y-2">
                      {agg.choices.length === 0 && <p className="text-xs text-gray-400">回答なし</p>}
                      {agg.choices.map((c) => (
                        <div key={c.value}>
                          <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                            <span className="truncate pr-2">{c.value}</span>
                            <span className="shrink-0 tabular-nums">{c.count}件（{c.percent}%）</span>
                          </div>
                          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-full rounded-full bg-brand" style={{ width: `${c.percent}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-auto">
                      {(agg.texts ?? []).length === 0 && <p className="text-xs text-gray-400">回答なし</p>}
                      {(agg.texts ?? []).map((t, i) => (
                        <div key={i} className="text-sm text-gray-700 border-b border-gray-50 pb-2 last:border-0">
                          <p className="whitespace-pre-wrap break-words">{t.value}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">{t.displayName || "(名前なし)"} ・ {fmtDateTime(t.createdAt)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 回答一覧 */}
          <section>
            <h2 className="text-sm font-bold text-gray-900 mb-3">回答一覧</h2>
            <div className="overflow-x-auto border border-gray-200 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-left font-medium px-3 py-2 whitespace-nowrap">回答日時</th>
                    <th className="text-left font-medium px-3 py-2 whitespace-nowrap">表示名</th>
                    <th className="text-left font-medium px-3 py-2 whitespace-nowrap hidden sm:table-cell">LINE userId</th>
                    <th className="text-left font-medium px-3 py-2">回答概要</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.submissions.map((s) => {
                    const summary = s.blocks.map((b) => `${b.label}: ${answerValueToText(b.value)}`).join(" / ");
                    const isOpen = expanded === s.id;
                    return (
                      <>
                        <tr key={s.id} className="border-t border-gray-100">
                          <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fmtDateTime(s.created_at)}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-700">{s.display_name || "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-400 hidden sm:table-cell font-mono text-xs">{s.line_user_id ? `${s.line_user_id.slice(0, 8)}…` : "—"}</td>
                          <td className="px-3 py-2 text-gray-600 max-w-[280px] truncate">{summary || "—"}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <button onClick={() => setExpanded(isOpen ? null : s.id)} className="text-xs text-brand-ink underline">
                              {isOpen ? "閉じる" : "詳細を見る"}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-gray-50/60">
                            <td colSpan={5} className="px-4 py-3">
                              <dl className="space-y-2">
                                {s.blocks.length === 0 && <p className="text-xs text-gray-400">回答内容がありません</p>}
                                {s.blocks.map((b, i) => (
                                  <div key={i} className="text-sm">
                                    <dt className="text-xs font-medium text-gray-500">{b.label}</dt>
                                    <dd className="text-gray-800 whitespace-pre-wrap break-words">{answerValueToText(b.value) || "—"}</dd>
                                  </div>
                                ))}
                              </dl>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="border border-gray-200 rounded-xl p-3 bg-white">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 font-bold text-gray-900 ${small ? "text-sm" : "text-2xl"} tabular-nums`}>{value}</div>
    </div>
  );
}
