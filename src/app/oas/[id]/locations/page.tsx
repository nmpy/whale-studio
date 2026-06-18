"use client";

// src/app/oas/[id]/locations/page.tsx
// 現地トリガー管理トップ（canonical / OA レベル）。
// 「現地トリガー」= 現地で QR / GPS / Beacon を使ってメッセージ進行・チェックインを発火する機能の総称。
// セクション0: 方式の比較（QRチェックイン / GPSチェックイン / Beaconチェックイン）。
// セクション1: チェックインポイント（QR/GPS を同一 Location の checkinMode で統合表示）。
// セクション2: Beaconチェックイン（Location とは別概念。OA共通+作品別 / 既存 /locations/beacons へ誘導）。
//
// 情報設計・文言の整理のみ。URL / API / DB / LIFF / checkin 判定 / 権限判定には触れない。

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
import { InlineWhaleLoader } from "@/components/ui/InlineWhaleLoader";

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
      <Breadcrumb items={[{ label: "アカウントリスト", href: "/oas" }, { label: "現地トリガー" }]} />

      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-round text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">現地トリガー</h1>
          <p className="mt-1 text-[12px] leading-[1.7] text-ink-3">
            現地で QR・GPS・Beacon を使って、メッセージ進行やチェックインを発火できます。
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
        <div className="rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-3"><InlineWhaleLoader padding={0} /></div>
      ) : !planAccess.allowed ? (
        <PlanRequiredCard oaId={oaId} featureKey={FEATURE.location} currentPlan={effectivePlan} featureLabel="ロケーション" />
      ) : (
        <>
          {/* ── セクション0: 現地トリガーの方式（QR / GPS / Beacon の比較） ── */}
          <section className="mb-6">
            <h2 className="mb-2 font-round text-[16px] font-bold text-ink">現地トリガーの方式</h2>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {[
                { icon: "📷", name: "QRチェックイン",     desc: "印刷物や看板の QR を読み取って進行する方式。低コストで安定しやすく、屋内外を問わず使いやすい。" },
                { icon: "📍", name: "GPSチェックイン",    desc: "指定地点の近くに来たら進行する方式。屋外の周遊や街歩きに向いている。" },
                { icon: "📡", name: "Beaconチェックイン", desc: "近距離に入ったことを検知して進行する方式。店舗・展示・屋内周遊に向いている。" },
              ].map((m) => (
                <div key={m.name} className="rounded-card border border-line bg-surface px-3.5 py-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span aria-hidden="true" className="text-[16px]">{m.icon}</span>
                    <span className="text-[13px] font-bold text-ink">{m.name}</span>
                  </div>
                  <p className="text-[11px] leading-[1.65] text-ink-3">{m.desc}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-[1.6] text-ink-3">
              QR・GPS は「チェックインポイント（地点）」として、Beacon は「Beaconチェックイン」として、それぞれ下で管理します。1 つの導線で併用もできます。
            </p>
          </section>

          {/* ── 集計カード ── */}
          <SummaryCards oaId={oaId} workIdFilter={workIdFilter} />

          {/* ── セクション1: チェックインポイント（QR / GPS 方式） ── */}
          <section className="mb-8">
            <div className="mb-2 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-round text-[16px] font-bold text-ink">チェックインポイント</h2>
                <p className="mt-0.5 text-[11px] leading-[1.6] text-ink-3">
                  QRチェックイン / GPSチェックインの到達判定地点を作品横断で一覧表示します。QR・GPS は同じ地点の判定方式（checkinMode）で、1 地点に両方を設定できます。
                </p>
              </div>
              {!readOnly && (
                <Link href={`/oas/${oaId}/locations/new${workIdFilter ? `?workId=${encodeURIComponent(workIdFilter)}` : ""}`} className={buttonClass({ variant: "primary", size: "sm" })}>
                  ＋ チェックインポイントを追加
                </Link>
              )}
            </div>
            <CheckpointList oaId={oaId} workIdFilter={workIdFilter} readOnly={readOnly} />
          </section>

          {/* ── セクション2: Beaconチェックイン ── */}
          <section className="mb-8">
            <h2 className="mb-2 font-round text-[16px] font-bold text-ink">Beaconチェックイン</h2>
            <Link
              href={`/oas/${oaId}/locations/beacons${workIdFilter ? `?workId=${encodeURIComponent(workIdFilter)}` : ""}`}
              className="group flex items-center gap-3.5 rounded-card border border-line bg-surface px-4 py-4 no-underline transition-all hover:-translate-y-px hover:border-brand/30 hover:shadow-card"
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-line bg-bg-tint text-[18px]">📡</div>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 text-[14px] font-bold text-ink group-hover:text-brand-ink">Beaconチェックインを管理</div>
                <div className="text-[12px] leading-[1.55] text-ink-2">
                  LINE Beacon の登録・発火メッセージ・ログ・テスト発火。Beacon はチェックインポイントとは別概念で、
                  <strong>OA 共通トリガー</strong>と<strong>作品別トリガー</strong>の両方を扱えます。
                </div>
              </div>
              <span aria-hidden="true" className="flex-shrink-0 self-center text-[16px] text-ink-3 group-hover:text-brand-ink">›</span>
            </Link>
          </section>

          {/* ── セクション3: 補足・注意 ── */}
          <section className="rounded-card border border-line bg-bg px-4 py-3.5 text-[11px] leading-[1.8] text-ink-3">
            <p className="mb-1 font-semibold text-ink-2">補足・注意</p>
            <p>· チェックインポイント（QR / GPS）は作品に紐づきます（OA 共通のチェックインポイントはありません）。OA 共通で発火させたい場合は Beaconチェックインをご利用ください。</p>
            <p>· QR / GPS は同じ地点の判定方式です。1 地点で QR と GPS の両方（GPS + QR）も設定できます。</p>
            <p>· 現地でのチェックイン URL（QR）は既存のものから変更されません。重要導線では QR / GPS / Beacon の併用を推奨します。</p>
          </section>
        </>
      )}
    </div>
  );
}
