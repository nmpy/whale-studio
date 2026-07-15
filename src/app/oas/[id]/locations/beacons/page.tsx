"use client";

// src/app/oas/[id]/locations/beacons/page.tsx
// LINE Beacon 管理（canonical / OA レベル）。
// OA 共通 + 全作品のビーコントリガーを 1 画面で管理する。
// 作品配下の旧画面（/oas/[id]/works/[workId]/beacons）からはバナーでここへ誘導する。

import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { buttonClass } from "@/components/shared";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useAccessPreview } from "@/hooks/useAccessPreview";
import { usePlatformRole } from "@/hooks/usePlatformRole";
import { getPlanAccessState, FEATURE } from "@/lib/constants/plans";
import { PlanRequiredCard } from "@/components/PlanRequiredCard";
import { OaBeaconList } from "./_oa-beacon-list";
import { InlineWhaleLoader } from "@/components/ui/InlineWhaleLoader";
import { withWorkId } from "../../_lib/work-context";

export default function OaBeaconsPage() {
  const params = useParams();
  const oaId = params.id as string;
  const searchParams = useSearchParams();
  const workIdFilter = searchParams.get("workId");

  const { role, isViewer, isTester, loading: roleLoading } = useWorkspaceRole(oaId);
  const { effectivePlan, loading: planLoading } = useAccessPreview(oaId);
  const { isPlatformOwner } = usePlatformRole();

  const readOnly = isViewer || isTester;
  const planAccess = getPlanAccessState({ plan: effectivePlan, featureKey: FEATURE.location });

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb
        items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "現地トリガー", href: withWorkId(`/oas/${oaId}/locations`, workIdFilter) },
          { label: "Beaconチェックイン" },
        ]}
      />

      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-round text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">Beaconチェックイン</h1>
          <p className="mt-1 text-[12px] leading-[1.7] text-ink-3">
            現地トリガーの方式のひとつです。LINE Beacon を使うと、ユーザーがビーコンの近くに来たタイミングでメッセージを送信できます。
            現地周遊・展示・受付・謎解きの地点通過演出に利用できます。
          </p>
        </div>
        {!readOnly && planAccess.allowed && !planLoading && (
          <Link href={withWorkId(`/oas/${oaId}/locations/beacons/new`, workIdFilter)} className={buttonClass({ variant: "primary", size: "md" })}>
            ＋ ビーコンを追加
          </Link>
        )}
      </div>

      {planLoading || roleLoading ? (
        <div className="rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-3"><InlineWhaleLoader padding={0} /></div>
      ) : !planAccess.allowed ? (
        <PlanRequiredCard oaId={oaId} featureKey={FEATURE.location} currentPlan={effectivePlan} featureLabel="ビーコン" />
      ) : (
        <OaBeaconList oaId={oaId} workIdFilter={workIdFilter} readOnly={readOnly} isPlatformAdmin={isPlatformOwner} />
      )}

      <div className="mt-6 rounded-card border border-line bg-bg px-4 py-3.5 text-[11px] leading-[1.8] text-ink-3">
        <p className="mb-1 font-semibold text-ink-2">ご利用にあたって</p>
        <p>· ユーザー側で Bluetooth と LINE Beacon 設定が有効で、対象の LINE 公式アカウントを友だち追加している必要があります。</p>
        <p>· 日本では実質「enter（受信圏に入った）」イベントのみが届きます。重要導線では QR / GPS の併用を推奨します。</p>
        {role && <span className="sr-only">role: {role}</span>}
      </div>
    </div>
  );
}
