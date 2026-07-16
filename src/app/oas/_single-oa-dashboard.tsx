"use client";

// src/app/oas/_single-oa-dashboard.tsx
//
// アカウントが 1 件だけのユーザー向けの「アカウントダッシュボード」。
//   - アカウント基本情報 / 作品管理・設定への導線 / プレイヤー KPI / 直近7日 / 作品一覧 /
//     プレイヤーアクティビティを 1 画面に集約する（選択のための一覧ではなく、概要画面）。
//   - 基本情報（名前・公開状態・権限・識別子・作成日時）は一覧取得済みの OaListItem を流用（再取得しない）。
//   - KPI / 7日 / 作品 / アクティビティは集約エンドポイント GET /api/oas/:id/dashboard を 1 回だけ叩く。
//   - グローバルヘッダー / 左レール / お知らせ（AppShell / 呼び出し側）はここでは扱わない（変更しない）。
//
// アクティビティは実ログのみ。保存されていないイベント種別（会話送受信・フェーズ開始・友だち追加・
// 回答判定・選択・通話リクエスト等）はダミーを出さず、0 件時は空状態を表示する。
//
// 集約 API のみが失敗したときは、上部にエラー + 再読み込み（集約 API のみ再取得・二重リクエスト防止）を出し、
// 各カードは「永久 skeleton」や「0 件の誤表示」にせず muted 表示にする。

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  oaApi, getDevToken, type OaListItem, type OaDashboard,
} from "@/lib/api-client";
import { StatusBadge, buttonClass } from "@/components/shared";
import { RoleBadge } from "@/components/PermissionGuard";
import { formatDateTime } from "@/lib/format-datetime";
import { usageTypeShortLabel } from "@/lib/usage-type";
import { ACTIVITY_META, ACTIVITY_TONE_CLASS } from "@/lib/activity-feed";
import type { Role } from "@/lib/types/permissions";

const STATUS_LABEL: Record<string, string> = { draft: "未設定", active: "公開中", paused: "停止中" };
function statusTone(s: string): "active" | "muted" | "warn" {
  if (s === "active") return "active";
  if (s === "paused") return "warn";
  return "muted";
}

/** ISO(UTC) → JST "MM/DD HH:mm"（アクティビティ行の時刻用）。 */
function fmtActivityTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = g("hour") === "24" ? "00" : g("hour");
  return `${g("month")}/${g("day")} ${hour}:${g("minute")}`;
}

// 作品カードでの表示上限（超過分は「すべての作品を見る」で作品一覧へ）。
const WORKS_PREVIEW_LIMIT = 6;

/** カードの読み込み失敗表示（永久 skeleton / 0 件誤表示を避けるための muted 表示）。 */
function CardLoadError() {
  return <p className="py-6 text-center text-[13px] text-ink-3">読み込めませんでした</p>;
}

export function SingleOaDashboard({
  oa,
  canCreateOa,
  isOwner,
  showUsageType,
  onDelete,
}: {
  oa: OaListItem;
  canCreateOa: boolean;
  isOwner: boolean;
  showUsageType: boolean;
  onDelete?: (id: string, title: string) => void;
}) {
  const [data, setData] = useState<OaDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const loadingRef = useRef(false);

  async function load() {
    if (loadingRef.current) return; // 再試行の二重リクエスト防止
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const d = await oaApi.dashboard(getDevToken(), oa.id);
      setData(d);
    } catch {
      // 内部情報は画面に出さず、一般的なメッセージのみ表示。
      setError("ダッシュボードの読み込みに失敗しました");
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [oa.id]);

  const failed = !!error && !loading; // 読み込み確定でエラー（＝ skeleton を出し続けない）
  const worksHref = `/oas/${oa.id}/works`;
  const worksNewHref = `/oas/${oa.id}/works/new`;
  const settingsHref = `/oas/${oa.id}/settings`;

  return (
    <>
      {/* タイトル行（アカウント + 件数 + 追加）は親のアカウント一覧が共通で表示するため、
          ここには置かない（1件時も 0件/複数件と同じヘッダーを共有＝デザイン統合）。 */}

      {/* ── アカウント概要カード ── */}
      <section className="mb-5 rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          {/* 左: 基本情報 */}
          <div className="flex min-w-0 flex-1 items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-round overflow-hidden text-ellipsis whitespace-nowrap text-[18px] font-extrabold leading-[1.3] text-ink">{oa.title}</h1>
                <StatusBadge tone={statusTone(oa.publish_status)}>{STATUS_LABEL[oa.publish_status] ?? oa.publish_status}</StatusBadge>
              </div>
              {/* 権限 / 種別 / 識別子 / 作成日時 */}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-ink-3">
                {oa.my_role && oa.my_role !== "none" && <RoleBadge role={oa.my_role as Role} />}
                {showUsageType && (
                  <span className={
                    "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold " +
                    (oa.usage_type === "business" ? "border-brand/30 bg-brand-soft text-brand-ink" : "border-line bg-bg-tint text-ink-2")
                  }>
                    {usageTypeShortLabel(oa.usage_type)}
                  </span>
                )}
                {oa.channel_id && <span className="font-mono text-ink-3">{oa.channel_id}</span>}
                {oa.line_oa_id && <span className="text-ink-3">@{oa.line_oa_id}</span>}
                <span className="font-num text-ink-3">作成 {formatDateTime(oa.created_at)}</span>
              </div>
            </div>
          </div>

          {/* 右: 操作 */}
          <div className="flex flex-shrink-0 items-center gap-2 self-start">
            <Link href={worksHref} className={buttonClass({ variant: "primary", size: "sm" })}>作品管理</Link>
            <Link href={settingsHref} className={buttonClass({ variant: "ghost", size: "sm" })}>設定</Link>
            {/* その他メニュー */}
            <div className="relative">
              <button
                type="button"
                aria-label="その他の操作"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-ink-2 transition-colors hover:border-brand hover:text-brand-ink"
              >
                <span aria-hidden="true" className="text-[18px] leading-none">…</span>
              </button>
              {menuOpen && (
                <>
                  <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} />
                  <div role="menu" className="absolute right-0 top-[calc(100%+4px)] z-20 min-w-[180px] overflow-hidden rounded-field border border-line bg-white py-1 shadow-card">
                    <Link role="menuitem" href={worksNewHref} onClick={() => setMenuOpen(false)} className="block px-3.5 py-2 text-[13px] text-ink hover:bg-brand-mist">作品を追加</Link>
                    <Link role="menuitem" href={settingsHref} onClick={() => setMenuOpen(false)} className="block px-3.5 py-2 text-[13px] text-ink hover:bg-brand-mist">アカウント設定</Link>
                    {isOwner && onDelete && (
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => { setMenuOpen(false); onDelete(oa.id, oa.title); }}
                        className="block w-full px-3.5 py-2 text-left text-[13px] text-danger hover:bg-danger-soft"
                      >
                        アカウントを削除
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── エラー（集約 API のみ）。再読み込みは集約 API のみ再取得・二重リクエスト防止 ── */}
      {failed && (
        <div role="alert" className="mb-5 flex items-center gap-3 rounded-field border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">
          <span>{error}</span>
          <button type="button" onClick={load} disabled={loading} className="underline hover:no-underline disabled:opacity-50">再読み込み</button>
        </div>
      )}

      {/* ── 3. KPI カード（4列 → 2列 → 1列）── */}
      <div className="mb-5 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="総プレイヤー" value={data?.kpis.total_players} unit="人" loading={loading} failed={failed} />
        <KpiCard label="今日の新規参加" value={data?.kpis.today_new_players} unit="人" loading={loading} failed={failed} />
        <KpiCard label="クリア済み" value={data?.kpis.cleared} unit="人" loading={loading} failed={failed} />
        <KpiCard label="クリア率" value={data?.kpis.clear_rate_pct} unit="%" loading={loading} failed={failed} />
      </div>

      {/* ── 4/5. 直近7日 + 作品（2列 → 1列）── */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WeeklyChartCard daily={data?.daily ?? null} loading={loading} failed={failed} />
        <WorksCard oaId={oa.id} works={data?.works ?? null} total={data?.works_total ?? null} loading={loading} failed={failed} newHref={worksNewHref} allHref={worksHref} />
      </div>

      {/* ── 6. プレイヤーのアクティビティ ── */}
      <ActivityCard activity={data?.activity ?? null} loading={loading} failed={failed} />
    </>
  );
}

/* ── KPI カード ── */
function KpiCard({ label, value, unit, loading, failed }: { label: string; value: number | undefined; unit: string; loading: boolean; failed: boolean }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3.5 shadow-sm">
      <div className="mb-1 text-[12px] text-ink-3">{label}</div>
      {loading ? (
        <div className="skeleton" style={{ width: 56, height: 30, borderRadius: 6 }} />
      ) : failed || value == null ? (
        <div className="font-num text-[28px] font-extrabold leading-none text-ink-3">—</div>
      ) : (
        <div className="font-num text-ink">
          <span className="text-[28px] font-extrabold leading-none tracking-[-0.02em] text-brand-ink">{value.toLocaleString()}</span>
          <span className="ml-1 text-[13px] text-ink-3">{unit}</span>
        </div>
      )}
    </div>
  );
}

/* ── 直近7日間の新規プレイヤー数（軽量 CSS 棒グラフ）── */
function WeeklyChartCard({ daily, loading, failed }: { daily: OaDashboard["daily"] | null; loading: boolean; failed: boolean }) {
  const bars = daily ?? [];
  const max = Math.max(1, ...bars.map((b) => b.count));
  const CHART_H = 88;
  const total = bars.reduce((s, b) => s + b.count, 0);
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-bold text-ink">直近7日間の新規プレイヤー数</h2>
      </div>
      {loading ? (
        <div className="skeleton" style={{ width: "100%", height: CHART_H + 24, borderRadius: 8 }} />
      ) : failed || daily == null ? (
        <CardLoadError />
      ) : (
        <figure
          className="m-0"
          aria-label={`直近7日間の日別 新規プレイヤー数。合計 ${total} 人。` + bars.map((b) => `${b.date} ${b.count}人`).join("、")}
        >
          <div className="flex items-end justify-between gap-1.5" style={{ height: CHART_H }}>
            {bars.map((b, i) => {
              const h = Math.round(8 + (b.count / max) * (CHART_H - 8));
              const isToday = i === bars.length - 1;
              return (
                <div key={b.date} className="flex flex-1 items-end" style={{ height: "100%" }}>
                  <div
                    role="img"
                    aria-label={`${b.date}（${b.label}）新規 ${b.count}人`}
                    title={`${b.date}（${b.label}）新規 ${b.count}人`}
                    className={"w-full rounded-md " + (isToday ? "bg-brand" : "bg-brand/25")}
                    style={{ height: h }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between gap-1.5">
            {bars.map((b) => (
              <div key={b.date} className="flex-1 text-center text-[11px] text-ink-3">{b.label}</div>
            ))}
          </div>
        </figure>
      )}
    </section>
  );
}

/* ── 作品一覧カード ── */
function WorksCard({
  oaId, works, total, loading, failed, newHref, allHref,
}: {
  oaId: string; works: OaDashboard["works"] | null; total: number | null; loading: boolean; failed: boolean; newHref: string; allHref: string;
}) {
  const shown = (works ?? []).slice(0, WORKS_PREVIEW_LIMIT);
  const overflow = (total ?? 0) - shown.length;
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-bold text-ink">作品{!loading && !failed && total != null ? `（${total}件）` : ""}</h2>
        <Link href={newHref} className={buttonClass({ variant: "ghost", size: "sm" })}>＋ 作品を追加</Link>
      </div>
      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => <div key={i} className="skeleton" style={{ width: "100%", height: 40, borderRadius: 8 }} />)}
        </div>
      ) : failed || works == null ? (
        <CardLoadError />
      ) : works.length === 0 ? (
        <div className="rounded-field border border-dashed border-line bg-bg px-4 py-6 text-center">
          <p className="text-[13px] font-semibold text-ink">作品がまだありません</p>
          <p className="mt-1 text-[12px] leading-[1.7] text-ink-3">最初の作品を追加して、物語づくりを始めましょう。</p>
          <Link href={newHref} className={buttonClass({ variant: "primary", size: "sm", className: "mt-3" })}>＋ 最初の作品を追加</Link>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-line/60">
          {shown.map((w) => (
            <div key={w.id} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
              <Link
                href={`/oas/${oaId}/works/${w.id}`}
                title={`${w.title} の作品管理へ`}
                className="inline-flex max-w-full items-center gap-1 text-[13px] font-semibold leading-[1.4] text-ink transition-colors hover:text-brand-ink hover:underline"
              >
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{w.title}</span>
                <span className="flex-shrink-0 text-ink-3">›</span>
              </Link>
              <div className="flex flex-col gap-x-3 gap-y-0.5 font-num text-[10px] leading-tight text-ink-3 sm:flex-row sm:flex-wrap">
                <span>作成 {formatDateTime(w.created_at)}</span>
                <span>更新 {formatDateTime(w.updated_at)}</span>
                <span>最終更新 {formatDateTime(w.latest_activity_at)}</span>
              </div>
            </div>
          ))}
          {overflow > 0 && (
            <div className="pt-2">
              <Link href={allHref} className="text-[12px] font-semibold text-brand-ink hover:underline">すべての作品を見る（他 {overflow} 件）›</Link>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ── プレイヤーのアクティビティ ── */
function ActivityCard({ activity, loading, failed }: { activity: OaDashboard["activity"] | null; loading: boolean; failed: boolean }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[14px] font-bold text-ink">プレイヤーのアクティビティ</h2>
        <span className="rounded-full border border-line bg-bg-tint px-2 py-0.5 text-[11px] text-ink-3">直近10件</span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ width: "100%", height: 34, borderRadius: 6 }} />)}
        </div>
      ) : failed || activity == null ? (
        <CardLoadError />
      ) : activity.length === 0 ? (
        <div className="rounded-field border border-dashed border-line bg-bg px-4 py-8 text-center">
          <p className="text-[13px] font-semibold text-ink">まだ表示できるアクティビティはありません</p>
          <p className="mx-auto mt-1 max-w-[420px] text-[12px] leading-[1.7] text-ink-3">
            プレイヤーがチェックインやLIFF操作などを行うと、ここに新しい順で表示されます。
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-line/60">
          {activity.map((a) => {
            const meta = ACTIVITY_META[a.kind];
            return (
              <li key={a.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="w-[92px] flex-shrink-0 font-num text-[11px] text-ink-3">{fmtActivityTime(a.at)}</span>
                <span className="w-[104px] flex-shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold text-ink">{a.playerTag}</span>
                <span className={"inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold " + ACTIVITY_TONE_CLASS[meta.tone]}>{meta.label}</span>
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-ink-2">{a.detail}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
