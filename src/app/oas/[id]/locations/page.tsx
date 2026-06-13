"use client";

// src/app/oas/[id]/locations/page.tsx
// ロケーション管理トップ（canonical / OA レベル）。
// セクション1: チェックインポイント（GPS/QR を同一 Location の checkinMode で統合表示）。
// セクション2: Beacon（Location とは別概念。OA共通+作品別を扱う / 既存 /locations/beacons へ誘導）。
//
// PR1: 統合トップ + 集約一覧の追加のみ。新規/編集/印刷は既存の作品スコープ画面へリンク。
// 既存 API / DB / LIFF / checkin 処理には触れない。

import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { buttonClass } from "@/components/shared";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useAccessPreview } from "@/hooks/useAccessPreview";
import { getPlanAccessState, FEATURE } from "@/lib/constants/plans";
import { PlanRequiredCard } from "@/components/PlanRequiredCard";
import { CheckpointList } from "./_checkpoint-list";
import { SummaryCards } from "./_summary-cards";

export default function OaLocationsPage() {
  const params = useParams();
  const oaId = params.id as string;
  const workIdFilter = useSearchParams().get("workId");

  const { isViewer, isTester, loading: roleLoading } = useWorkspaceRole(oaId);
  const { effectivePlan, loading: planLoading } = useAccessPreview(oaId);

  const readOnly = isViewer || isTester;
  const planAccess = getPlanAccessState({ plan: effectivePlan, featureKey: FEATURE.location });

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb items={[{ label: "アカウントリスト", href: "/oas" }, { label: "ロケーション管理" }]} />

      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-round text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">ロケーション管理</h1>
          <p className="mt-1 text-[12px] leading-[1.7] text-ink-3">
            GPS / QR / Beacon など、現地の地点やチェックイン方法に紐づく機能をまとめて管理できます。
          </p>
        </div>
        <Link
          href={`/oas/${oaId}/locations/logs${workIdFilter ? `?workId=${encodeURIComponent(workIdFilter)}` : ""}`}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          ログを見る
        </Link>
      </div>

      {planLoading || roleLoading ? (
        <div className="rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-3">読み込み中…</div>
      ) : !planAccess.allowed ? (
        <PlanRequiredCard oaId={oaId} featureKey={FEATURE.location} currentPlan={effectivePlan} featureLabel="ロケーション" />
      ) : (
        <>
          {/* ── 集計カード ── */}
          <SummaryCards oaId={oaId} workIdFilter={workIdFilter} />

          {/* ── セクション1: チェックインポイント ── */}
          <section className="mb-8">
            <div className="mb-2 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-round text-[16px] font-bold text-ink">チェックインポイント</h2>
                <p className="mt-0.5 text-[11px] leading-[1.6] text-ink-3">
                  GPS / QR の到達判定地点を作品横断で一覧表示します。GPS・QR は同じ地点の判定方式（checkinMode）です。
                </p>
              </div>
              {!readOnly && (
                <Link href={`/oas/${oaId}/locations/new${workIdFilter ? `?workId=${encodeURIComponent(workIdFilter)}` : ""}`} className={buttonClass({ variant: "primary", size: "sm" })}>
                  ＋ 追加
                </Link>
              )}
            </div>
            <CheckpointList oaId={oaId} workIdFilter={workIdFilter} readOnly={readOnly} />
          </section>

          {/* ── セクション2: Beacon ── */}
          <section className="mb-8">
            <h2 className="mb-2 font-round text-[16px] font-bold text-ink">Beacon</h2>
            <Link
              href={`/oas/${oaId}/locations/beacons${workIdFilter ? `?workId=${encodeURIComponent(workIdFilter)}` : ""}`}
              className="group flex items-center gap-3.5 rounded-card border border-line bg-surface px-4 py-4 no-underline transition-all hover:-translate-y-px hover:border-brand/30 hover:shadow-card"
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-line bg-bg-tint text-[18px]">📡</div>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 text-[14px] font-bold text-ink group-hover:text-brand-ink">Beacon 管理</div>
                <div className="text-[12px] leading-[1.55] text-ink-2">
                  LINE Beacon の登録・発火メッセージ・ログ・テスト発火。Beacon はチェックインポイントとは別概念で、
                  <strong>OA 共通トリガー</strong>と<strong>作品別トリガー</strong>の両方を扱えます。
                </div>
              </div>
              <span aria-hidden="true" className="flex-shrink-0 self-center text-[16px] text-ink-3 group-hover:text-brand-ink">›</span>
            </Link>
          </section>

          {/* ── セクション3: 使い方 / 注意 ── */}
          <section className="rounded-card border border-line bg-bg px-4 py-3.5 text-[11px] leading-[1.8] text-ink-3">
            <p className="mb-1 font-semibold text-ink-2">使い方・注意</p>
            <p>· チェックインポイントは作品に紐づきます（OA 共通のチェックインポイントはありません）。OA 共通で発火させたい場合は Beacon をご利用ください。</p>
            <p>· QR / GPS は同じ地点の判定方式です。1 地点で QR と GPS の両方（GPS + QR）も設定できます。</p>
            <p>· 現地でのチェックイン URL（QR）は既存のものから変更されません。重要導線では QR / GPS / Beacon の併用を推奨します。</p>
          </section>
        </>
      )}
    </div>
  );
}
