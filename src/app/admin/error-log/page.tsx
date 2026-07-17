// src/app/admin/error-log/page.tsx
// スタジオ全体エラーログ（Phase 2・プラットフォームオーナー向け）。
//   - /admin 配下（サーバー認可済み）だが platform owner 限定のため追加で厳格判定する。
//   - Server Component: フィルタ・グローバルページネーション・サマリーをサーバーで集約。
//   - フィルタ / 行操作 / 一括操作だけを小さな Client Component に分離。読み取り + 解決状態のみ（既存ログ不変）。

import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerUser } from "@/lib/supabase/server";
import { isPlatformOwner } from "@/lib/platform-admin";
import { getErrorLogView, ERROR_LOG_PAGE_SIZE } from "@/lib/owner-error-log/service";
import { ErrorLogFilters } from "./_filters";
import { ErrorLogTable } from "./_table";
import { ErrorLogActionsBar } from "./_actions-bar";

export const dynamic = "force-dynamic";

function SummaryCard({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: boolean }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface px-4 py-4 shadow-sm">
      <div className="text-[11px] font-bold text-ink-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={"font-num text-[22px] font-bold " + (accent ? "text-brand-ink" : "text-ink")}>{value}</span>
        {unit && <span className="text-[12px] text-ink-3">{unit}</span>}
      </div>
    </div>
  );
}

/** page 以外のフィルタを querystring 化（CSV エクスポート用）。 */
function filtersToQuery(f: { status: string; oaId: string | null; type: string; period: string }): string {
  const p = new URLSearchParams();
  if (f.status !== "unresolved") p.set("status", f.status);
  if (f.oaId) p.set("oa", f.oaId);
  if (f.type !== "all") p.set("type", f.type);
  if (f.period !== "7d") p.set("period", f.period);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** ページ番号を維持したフィルタ querystring。 */
function pageHref(f: { status: string; oaId: string | null; type: string; period: string }, page: number): string {
  const p = new URLSearchParams();
  if (f.status !== "unresolved") p.set("status", f.status);
  if (f.oaId) p.set("oa", f.oaId);
  if (f.type !== "all") p.set("type", f.type);
  if (f.period !== "7d") p.set("period", f.period);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `/admin/error-log?${s}` : "/admin/error-log";
}

export default async function OwnerErrorLogPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const user = await getServerUser();
  if (!user) redirect("/login?next=/admin/error-log");
  if (!isPlatformOwner(user.id)) redirect("/admin/announcements");

  const view = await getErrorLogView(searchParams ?? {}, new Date());
  const { items, total, page, pageCount, filters, summary, accounts, failed } = view;

  const from = total === 0 ? 0 : (page - 1) * ERROR_LOG_PAGE_SIZE + 1;
  const to = Math.min(total, page * ERROR_LOG_PAGE_SIZE);
  const unresolvedOnPage = items.filter((i) => !i.isResolved).map((i) => ({ source: i.source, sourceId: i.sourceId }));

  return (
    <div className="min-w-0 flex-1" style={{ maxWidth: 1200 }}>
      {/* パンくず */}
      <nav aria-label="パンくず" className="mb-2 flex items-center gap-1.5 text-[12px] text-ink-3">
        <Link href="/admin/dashboard" className="hover:text-brand-ink hover:underline">スタジオ全体ダッシュボード</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page" className="font-semibold text-ink-2">エラーログ</span>
      </nav>

      {/* タイトル行 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-round text-[20px] font-bold text-ink">エラーログ</h1>
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-bold" style={{ background: "#fdeeed", color: "#c2564d" }}>
          未解決 {summary.unresolved.toLocaleString()}件
        </span>
        <div className="ml-auto">
          <ErrorLogActionsBar
            exportQuery={filtersToQuery(filters)}
            unresolvedOnPage={unresolvedOnPage}
            disabled={failed}
          />
        </div>
      </div>

      {/* サマリー 4 枚 */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="直近7日の失敗" value={summary.recent7dFailures.toLocaleString()} unit="件" />
        <SummaryCard label="未解決" value={summary.unresolved.toLocaleString()} unit="件" accent />
        <SummaryCard label="失敗率（直近7日）" value={String(summary.failureRatePct)} unit="%" />
        <SummaryCard label="最多の原因（直近7日）" value={summary.topCause} />
      </div>

      {/* フィルタ */}
      <ErrorLogFilters filters={filters} accounts={accounts} />

      {/* 本体 */}
      {failed ? (
        <div className="mt-4 rounded-[14px] border border-line bg-surface px-5 py-10 text-center shadow-sm">
          <p className="text-[13px] font-semibold text-ink-2">エラーログを読み込めませんでした</p>
          <p className="mt-1 text-[12px] text-ink-3">時間をおいて再度お試しください。</p>
        </div>
      ) : (
        <>
          <div className="mt-4">
            <ErrorLogTable items={items} />
          </div>

          {/* ページャ */}
          {total > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-3">
              <span>全{total.toLocaleString()}件中 {from.toLocaleString()}–{to.toLocaleString()}件</span>
              <nav aria-label="ページ送り" className="flex items-center gap-1">
                {page > 1 ? (
                  <Link href={pageHref(filters, page - 1)} aria-label="前のページ" className="rounded-lg border border-line bg-surface px-2.5 py-1 font-semibold text-ink-2 hover:border-brand hover:text-brand-ink">前へ</Link>
                ) : (
                  <span aria-disabled="true" className="rounded-lg border border-line bg-bg-tint px-2.5 py-1 text-ink-3">前へ</span>
                )}
                <span aria-current="page" className="px-2 font-num font-semibold text-ink-2">{page} / {pageCount}</span>
                {page < pageCount ? (
                  <Link href={pageHref(filters, page + 1)} aria-label="次のページ" className="rounded-lg border border-line bg-surface px-2.5 py-1 font-semibold text-ink-2 hover:border-brand hover:text-brand-ink">次へ</Link>
                ) : (
                  <span aria-disabled="true" className="rounded-lg border border-line bg-bg-tint px-2.5 py-1 text-ink-3">次へ</span>
                )}
              </nav>
            </div>
          )}
        </>
      )}
    </div>
  );
}
