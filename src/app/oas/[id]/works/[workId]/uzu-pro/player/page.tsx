// src/app/oas/[id]/works/[workId]/uzu-pro/player/page.tsx
// for ウズプロ ＞ プレイヤー画面（Server Component）。
//   - 認可は layout.tsx で強制済みだが、多層防御でここでも canAccessUzuPro を再確認。
//   - View Model（PII フリー）をサーバーで集約し、フィルタ / 表 / 一括操作を Client へ分離。
//   - 氏名 / メール等は一切描画しない（View Model にそもそも含まれない）。

import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getServerUser } from "@/lib/supabase/server";
import { canAccessUzuPro } from "@/lib/uzupro";
import { isAuthorizedLiffManager } from "@/lib/uzupro/liff-manager";
import { getUzuProPlayerView, parsePlayerFilters } from "@/lib/uzupro/player-view";
import { formatDateTime } from "@/lib/format-datetime";
import { Breadcrumb } from "@/components/Breadcrumb";
import { UzuProPlayerFilters } from "./_filters";
import { UzuProPlayerTable } from "./_table";
import { UzuProPlayerActionsBar } from "./_actions-bar";

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

export default async function UzuProPlayerPage({
  params,
  searchParams,
}: {
  params: { id: string; workId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const user = await getServerUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/oas/${params.id}/works/${params.workId}/uzu-pro/player`)}`);
  }
  // 多層防御: layout で強制済みだが Server 側でも再確認（存在露出しないため 404）。
  if (!(await canAccessUzuPro(params.id, user.id, params.workId))) notFound();

  const work = await prisma.work.findFirst({
    where: { id: params.workId, oaId: params.id },
    select: { title: true },
  });
  if (!work) notFound();

  // LIFF 発行・LINE 手動操作は allowlist の LIFF 管理者のみ（UI は非表示、API でも強制）。
  const canManageLiff = isAuthorizedLiffManager(user.id);

  const filters = parsePlayerFilters(searchParams ?? {});
  const view = await getUzuProPlayerView({ oaId: params.id, workId: params.workId, filters });
  const { summary, bookings, sessions, bulk, lastSyncedAt, syncStatus } = view;

  return (
    <div className="min-w-0 flex-1" style={{ maxWidth: 1200 }}>
      <Breadcrumb
        items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "作品リスト", href: `/oas/${params.id}/works` },
          { label: work.title, href: `/oas/${params.id}/works/${params.workId}` },
          { label: "プレイヤー" },
        ]}
      />

      {/* タイトル行 */}
      <div className="mb-4 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-round text-[20px] font-bold text-ink">プレイヤー</h1>
        <span className="inline-flex items-center rounded-full bg-brand-soft px-2.5 py-0.5 text-[12px] font-bold text-brand-ink">
          for ウズプロ
        </span>

        {/* 同期ステータス + 最終同期 */}
        <span
          className={
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold " +
            (syncStatus === "error" ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand-ink")
          }
        >
          {syncStatus === "error" ? `同期エラー ${summary.syncError}件` : "同期OK"}
        </span>
        <span className="text-[12px] text-ink-3">
          最終同期: <span className="font-num">{formatDateTime(lastSyncedAt)}</span>
        </span>

        <div className="ml-auto">
          <UzuProPlayerActionsBar oaId={params.id} workId={params.workId} workTitle={work.title} bulk={bulk} canManage={canManageLiff} />
        </div>
      </div>

      {/* サマリー 5 枚 */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryCard label="総数" value={summary.total.toLocaleString()} unit="名" />
        <SummaryCard label="LIFF発行済み" value={summary.liffIssued.toLocaleString()} unit="名" accent />
        <SummaryCard label="LIFF未発行" value={summary.liffUnissued.toLocaleString()} unit="名" />
        <SummaryCard label="LINE連携済み" value={summary.lineLinked.toLocaleString()} unit="名" />
        <SummaryCard label="同期エラー" value={summary.syncError.toLocaleString()} unit="名" />
      </div>

      {/* フィルタ */}
      <UzuProPlayerFilters oaId={params.id} workId={params.workId} filters={filters} sessions={sessions} />

      {/* 同期エラーの注意帯 */}
      {syncStatus === "error" && (
        <div className="mt-4 rounded-[14px] border border-danger/30 bg-danger-soft px-4 py-3 text-[12px] font-semibold text-danger">
          一部のプレイヤーで LIFF 発行エラーが発生しています。該当行から「失効して再発行」で復旧できます。
        </div>
      )}

      {/* 本体 */}
      <div className="mt-4">
        <UzuProPlayerTable oaId={params.id} workId={params.workId} bookings={bookings} canManage={canManageLiff} />
      </div>
    </div>
  );
}
