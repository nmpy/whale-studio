// src/app/admin/dashboard/page.tsx
// スタジオ全体ダッシュボード（プラットフォームオーナー向け）。
//   - /admin 配下（サーバー認可済み）だが、本画面は platform owner 限定のため追加で厳格判定する。
//   - Server Component: 集約サービスをサーバーで実行し、期間は ?period= で切替（再集計）。
//   - インタラクション（期間切替・エラー詳細開閉・お知らせ帯）だけを小さな Client Component に分離。
//   - 読み取り専用・DB/schema 変更なし。全アカウント横断集計。

import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerUser } from "@/lib/supabase/server";
import { isPlatformOwner } from "@/lib/platform-admin";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { getOwnerDashboard, normalizePeriod, accountColor } from "@/lib/owner-dashboard/aggregate";
import { getOwnerActivity } from "@/lib/owner-dashboard/activity";
import { PeriodSelect } from "./_period-select";
import { ErrorRateCard } from "./_error-rate-card";
import { ActivitySection } from "./_activity-section";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { draft: "未設定", active: "公開中", paused: "停止中" };
const PERIOD_LABEL: Record<string, string> = { "7d": "直近7日", "30d": "直近30日", month: "今月" };

function fmtMMDD(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("month")}/${g("day")}`;
}

function StatCard({ label, value, unit, sub, accent }: { label: string; value: string; unit?: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface px-4 py-4 shadow-sm">
      <div className="text-[11px] font-bold text-ink-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={"font-num text-[24px] font-bold " + (accent ? "text-brand-ink" : "text-ink")}>{value}</span>
        {unit && <span className="text-[12px] text-ink-3">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

export default async function OwnerDashboardPage({ searchParams }: { searchParams?: { period?: string } }) {
  // ── 厳格な platform owner 判定（/admin は workspace owner も入れるため、ここで絞る）──
  const user = await getServerUser();
  if (!user) redirect("/login?next=/admin/dashboard");
  if (!isPlatformOwner(user.id)) redirect("/admin/announcements");

  const period = normalizePeriod(searchParams?.period);
  // 横断アクティビティ（期間非依存の「最新8件」）はサマリー集計と並列実行する。
  const [data, activity] = await Promise.all([
    getOwnerDashboard(period, new Date()),
    getOwnerActivity(),
  ]);
  const { summary, daily, accountBreakdown, accountTable, errorBreakdown } = data;

  const chartMax = Math.max(1, ...daily.map((d) => d.count));
  const chartTotal = daily.reduce((s, d) => s + d.count, 0);
  const compact = daily.length > 10; // 30日/今月は細バー
  const breakdownTotal = accountBreakdown.reduce((s, a) => s + a.players, 0);

  return (
    <div className="min-w-0 flex-1" style={{ maxWidth: 1200 }}>
      {/* タイトル行 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-round text-[20px] font-bold text-ink">スタジオ全体ダッシュボード</h1>
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-bold" style={{ background: "#e7effd", color: "#3b6fd4" }}>オーナー</span>
        <div className="ml-auto flex items-center gap-2">
          <PeriodSelect period={period} />
          <Link href="/oas" className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition-colors hover:border-brand hover:text-brand-ink">アカウント一覧へ ›</Link>
        </div>
      </div>

      {/* お知らせ帯（共有・アカウント一覧と同仕様） */}
      <div className="mb-4">
        <AnnouncementBanner canPost={true} />
      </div>

      {/* サマリー 6 枚（6列）。エラー率カードは開くと下に詳細パネル（col-span-full）。 */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="アカウント" value={summary.accounts.toLocaleString()} unit="件" sub={`${summary.publishedAccounts}件が公開中`} />
        <StatCard label="総プレイヤー" value={summary.totalPlayers.toLocaleString()} unit="人" sub="全アカウント合計" />
        <StatCard label="公開中の作品" value={summary.publishedWorks.toLocaleString()} unit="件" sub={`下書き含む総数 ${summary.totalWorks}件`} />
        <StatCard label="今日の参加" value={summary.joinedToday.toLocaleString()} unit="人" accent sub={`前日比 ${summary.joinedToday - summary.joinedYesterday >= 0 ? "+" : ""}${summary.joinedToday - summary.joinedYesterday}`} />
        <StatCard label="クリア率（平均）" value={String(summary.clearRatePct)} unit="%" accent />
        <ErrorRateCard summary={summary} errorBreakdown={errorBreakdown} periodLabel={PERIOD_LABEL[period]} />
      </div>

      {/* チャート + アカウント別内訳 */}
      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-[14px] border border-line bg-surface p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-bold text-ink">直近{daily.length}日間のプレイヤー数（全アカウント合計）</h2>
            <span className="text-[12px] text-ink-3">合計 {chartTotal} 人</span>
          </div>
          <figure className="m-0" aria-label={`日別 新規プレイヤー数。合計 ${chartTotal} 人。` + daily.map((d) => `${d.date} ${d.count}人`).join("、")}>
            <div className="flex items-end justify-between gap-[3px]" style={{ height: 120 }}>
              {daily.map((d, i) => {
                const h = Math.round(8 + (d.count / chartMax) * 100);
                const today = i === daily.length - 1;
                return (
                  <div key={d.date} className="flex flex-1 flex-col items-center justify-end" style={{ height: "100%" }} title={`${d.date} ${d.count}人`}>
                    {!compact && <span className="mb-0.5 font-num text-[10px] font-bold" style={{ color: "#7d8a83" }}>{d.count || ""}</span>}
                    <span className="w-full" style={{ height: h, borderRadius: "6px 6px 3px 3px", background: today ? "#22a558" : "#bfe6cc" }} />
                  </div>
                );
              })}
            </div>
            {!compact && (
              <div className="mt-1 flex justify-between gap-[3px]">
                {daily.map((d) => <span key={d.date} className="flex-1 text-center text-[10px] text-ink-3">{d.label}</span>)}
              </div>
            )}
          </figure>
        </section>

        <section className="rounded-[14px] border border-line bg-surface p-5 shadow-sm">
          <h2 className="mb-3 text-[13px] font-bold text-ink">プレイヤー内訳（アカウント別）</h2>
          {accountBreakdown.length === 0 || breakdownTotal === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-3">まだプレイヤーがいません</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {accountBreakdown.slice(0, 8).map((a) => {
                const c = accountColor(a.oaId);
                return (
                  <div key={a.oaId}>
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: c.dot }} />
                      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-ink">{a.name}</span>
                      <span className="font-num font-bold text-ink">{a.players.toLocaleString()}</span>
                      <span className="font-num text-ink-3">{a.pct}%</span>
                    </div>
                    <span className="mt-1 block h-2 w-full overflow-hidden rounded-full" style={{ background: "#eef2ee" }}>
                      <span className="block h-full rounded-full" style={{ width: `${a.pct}%`, background: c.dot }} />
                    </span>
                  </div>
                );
              })}
              {accountBreakdown.length > 8 && <Link href="/oas" className="mt-1 text-[12px] font-semibold text-brand-ink hover:underline">すべて見る（{accountBreakdown.length}件）›</Link>}
            </div>
          )}
        </section>
      </div>

      {/* アカウント別サマリー表 */}
      <section className="mb-4 overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
        <div className="flex items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-bold text-ink">アカウント別サマリー</h2>
            <span className="rounded-full border border-line bg-bg-tint px-2 py-0.5 text-[11px] text-ink-3">{accountTable.length}件</span>
          </div>
          <Link href="/oas" className="text-[12px] font-semibold text-brand-ink hover:underline">アカウント一覧へ ›</Link>
        </div>
        {accountTable.length === 0 ? (
          <p className="px-5 pb-6 text-center text-[13px] text-ink-3">アカウントがありません</p>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-t border-line text-left text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-3">
                <th className="px-5 py-2 font-semibold">アカウント</th>
                <th className="px-2 py-2 text-right font-semibold">プレイヤー</th>
                <th className="px-2 py-2 text-right font-semibold">作品</th>
                <th className="px-2 py-2 font-semibold">最新の作品</th>
                <th className="px-2 py-2 font-semibold">最終更新</th>
                <th className="px-5 py-2 text-right font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {accountTable.map((a) => {
                const c = accountColor(a.oaId);
                return (
                  <tr key={a.oaId} className="border-t border-[#f5f7f4] hover:bg-[#fafcfa]">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] font-round text-[13px] font-bold" style={{ background: c.bg, color: c.text }}>{(a.name.trim().charAt(0) || "?").toUpperCase()}</span>
                        <div className="min-w-0">
                          <div className="max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-ink">{a.name}</div>
                          <div className="text-[10px] text-ink-3">{STATUS_LABEL[a.publishStatus] ?? a.publishStatus}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right font-num font-bold text-ink">{a.players.toLocaleString()}</td>
                    <td className="px-2 py-3 text-right font-num text-ink-2">{a.works.toLocaleString()}</td>
                    <td className="px-2 py-3"><span className="block max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-brand-ink">{a.latestWorkTitle ?? "—"}</span></td>
                    <td className="px-2 py-3 font-num text-ink-3">{fmtMMDD(a.latestActivityAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link href={a.href} className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold" style={{ background: "#e6f6ec", color: "#178a48" }}>開く</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* 全アカウント横断アクティビティ（直近8件・期間非依存） */}
      <ActivitySection items={activity} />
    </div>
  );
}
