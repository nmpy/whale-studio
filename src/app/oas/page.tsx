// src/app/oas/page.tsx
// アカウント一覧（オーナートップ）。
//   - platform owner の場合のみ、上部に「スタジオ全体ダッシュボード」を表示し、その下に既存のアカウント一覧を表示する。
//   - 非 platform owner（workspace owner / 一般）は従来どおりアカウント一覧のみ。横断集計クエリはサーバーで実行しない。
//   - platform owner 判定・横断集計はサーバーで行い、クライアントへ Prisma モデルを渡さない。
//   - ダッシュボード取得が失敗しても、アカウント一覧は継続表示する（0 と取得失敗を混同しない）。
//   - お知らせ帯はアカウント一覧（OaListClient）側で1回だけ表示する（ダッシュボードには含めない）。

import { getServerUser } from "@/lib/supabase/server";
import { isPlatformOwner } from "@/lib/platform-admin";
import { getOwnerDashboard, normalizePeriod, type OwnerDashboardData } from "@/lib/owner-dashboard/aggregate";
import { getOwnerActivity, type OwnerActivityItem } from "@/lib/owner-dashboard/activity";
import { OwnerDashboardSection } from "@/app/_components/owner-dashboard/owner-dashboard-section";
import { OaListClient } from "./_list-client";

export const dynamic = "force-dynamic";

type DashboardResult =
  | { ok: true; data: OwnerDashboardData; activity: OwnerActivityItem[] }
  | { ok: false };

export default async function OasPage({ searchParams }: { searchParams?: { period?: string } }) {
  const user = await getServerUser();
  const isOwner = !!user && isPlatformOwner(user.id);
  const period = normalizePeriod(searchParams?.period);

  // 横断集計は platform owner のときだけ実行（非対象ユーザーでは Promise 自体を作らない）。
  let dashboard: DashboardResult | null = null;
  if (isOwner) {
    try {
      const [data, activity] = await Promise.all([
        getOwnerDashboard(period, new Date()),
        getOwnerActivity(),
      ]);
      dashboard = { ok: true, data, activity };
    } catch {
      dashboard = { ok: false };
    }
  }

  return (
    <>
      {isOwner && dashboard?.ok && (
        <div className="mb-10">
          <OwnerDashboardSection data={dashboard.data} activity={dashboard.activity} period={period} showAccountSummary={false} accountListHref={null} />
        </div>
      )}
      {isOwner && dashboard && !dashboard.ok && (
        <div className="mb-10 rounded-[14px] border border-line bg-surface px-5 py-6 text-center shadow-sm">
          <p className="text-[13px] font-semibold text-ink-2">スタジオ全体ダッシュボードを読み込めませんでした</p>
          <p className="mt-1 text-[12px] text-ink-3">時間をおいて再度お試しください。アカウント一覧は下に表示されています。</p>
        </div>
      )}

      <OaListClient />
    </>
  );
}
