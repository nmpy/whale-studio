// src/app/oas/[id]/works/[workId]/uzu-pro/status/page.tsx
// for UZU Pro ＞ 連携状況（Server Component / for UZU Pro のランディング）。
//   - Whale Studio 内の for UZU Pro 連携状態を確認する業務向けダッシュボード。
//   - 認可は layout.tsx で強制済みだが、多層防御でここでも canAccessUzuPro を再確認。
//   - oaId + workId の両方でスコープ検証（work が対象 OA に属することを findFirst で確認）。
//   - 表示は件数・状態・日時・任意の CMS 外部リンクのみ。氏名/メール/購入情報/LINE UID/内部主キーは扱わない。
//   - read-only。書き込み・再試行・強制修復・ディスパッチ・メール送信は持たない（将来 for Admin の責務）。

import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getServerUser } from "@/lib/supabase/server";
import { canAccessUzuPro } from "@/lib/uzupro";
import { getUzuProStatusView } from "@/lib/uzupro/status-view";
import { formatDateTime } from "@/lib/format-datetime";
import { Breadcrumb } from "@/components/Breadcrumb";

export const dynamic = "force-dynamic";

// LIFF status（既存 enum）→ 画面表示（日本語）の明示マッピング。文字列推測で状態を新設しない。
const LIFF_LABEL: Record<"issued" | "revoked" | "linked" | "error", string> = {
  issued: "有効",
  revoked: "失効",
  linked: "LINE連携済み",
  error: "エラー",
};

function StatCard({
  label,
  value,
  unit,
  accent,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-line bg-surface px-4 py-4 shadow-sm">
      <div className="text-[11px] font-bold text-ink-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={"font-num text-[22px] font-bold " + (accent ? "text-brand-ink" : "text-ink")}>{value}</span>
        {unit && <span className="text-[12px] text-ink-3">{unit}</span>}
      </div>
      {sub && <div className="mt-2 text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

export default async function UzuProStatusPage({
  params,
}: {
  params: { id: string; workId: string };
}) {
  const user = await getServerUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/oas/${params.id}/works/${params.workId}/uzu-pro/status`)}`);
  }
  // 多層防御: layout で強制済みだが Server 側でも再確認（存在露出しないため 404）。
  if (!(await canAccessUzuPro(params.id, user.id, params.workId))) notFound();

  // スコープ検証: work が対象 OA に属することを確認（URL の workId 差し替え対策）。
  const work = await prisma.work.findFirst({
    where: { id: params.workId, oaId: params.id },
    select: { title: true },
  });
  if (!work) notFound();

  const view = await getUzuProStatusView({ oaId: params.id, workId: params.workId });
  const { sessions, liff, players, lastBookingSyncedAt, errors, cmsUrl } = view;

  const hasError = errors.total > 0;
  const isEmpty = sessions === 0 && players.total === 0 && liff.total === 0;

  return (
    <div className="min-w-0 flex-1" style={{ maxWidth: 1200 }}>
      <Breadcrumb
        items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "作品リスト", href: `/oas/${params.id}/works` },
          { label: work.title, href: `/oas/${params.id}/works/${params.workId}` },
          { label: "連携状況" },
        ]}
      />

      {/* タイトル行 */}
      <div className="mb-4 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-round text-[20px] font-bold text-ink">連携状況</h1>
        <span className="inline-flex items-center rounded-full bg-brand-soft px-2.5 py-0.5 text-[12px] font-bold text-brand-ink">
          for ウズプロ
        </span>
        <span
          className={
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold " +
            (hasError ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand-ink")
          }
        >
          {hasError ? `要確認 ${errors.total}件` : "エラーなし"}
        </span>
        <span className="text-[12px] text-ink-3">
          最終予約同期: <span className="font-num">{formatDateTime(lastBookingSyncedAt)}</span>
        </span>

        {cmsUrl && (
          <a
            href={cmsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center rounded-[10px] border border-line bg-surface px-3 py-1.5 text-[12px] font-bold text-ink shadow-sm hover:bg-line-2"
          >
            UZU Pro CMS を開く ↗
          </a>
        )}
      </div>

      {isEmpty ? (
        <div className="rounded-[14px] border border-line bg-surface px-5 py-10 text-center">
          <div className="text-[14px] font-bold text-ink">まだ連携データがありません</div>
          <div className="mt-1 text-[12px] text-ink-3">
            UZU Pro CMS からの公演セッション同期・予約/プレイヤー同期が行われると、ここに連携状況が表示されます。
          </div>
        </div>
      ) : (
        <>
          {hasError && (
            <div className="mb-4 rounded-[14px] border border-danger/30 bg-danger-soft px-4 py-3 text-[12px] font-semibold text-danger">
              要確認のエラーがあります（同期リクエスト {errors.syncRequests}件 / LIFF {errors.liffLinks}件）。
              詳細な障害調査・再試行は for Admin 側で対応予定です。
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="UZU_PRO セッション数" value={sessions.toLocaleString()} unit="件" accent />
            <StatCard
              label="LIFF リンク総数"
              value={liff.total.toLocaleString()}
              unit="件"
              sub={
                <span>
                  {LIFF_LABEL.issued} {liff.issued} / {LIFF_LABEL.revoked} {liff.revoked} / {LIFF_LABEL.linked}{" "}
                  {liff.linked} / {LIFF_LABEL.error} {liff.error}
                </span>
              }
            />
            <StatCard
              label="登録プレイヤー"
              value={players.active.toLocaleString()}
              unit="名"
              sub={<span>キャンセル済み {players.cancelled.toLocaleString()} 名</span>}
            />
            <StatCard
              label="同期エラー"
              value={errors.total.toLocaleString()}
              unit="件"
              sub={<span>同期リクエスト {errors.syncRequests} / LIFF {errors.liffLinks}</span>}
            />
          </div>
        </>
      )}
    </div>
  );
}
