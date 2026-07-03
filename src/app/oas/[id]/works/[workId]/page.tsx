"use client";

// src/app/oas/[id]/works/[workId]/page.tsx
// 作品ハブ — 各管理機能へのナビゲーション

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { OaHeaderActions } from "@/components/OaHeaderActions";
import { workApi, oaApi, phaseApi, transitionApi, getDevToken } from "@/lib/api-client";
import type { WorkListItem } from "@/lib/api-client";
import { HelpAccordion } from "@/components/HelpAccordion";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useEffectivePlanInfo } from "@/hooks/useEffectivePlanInfo";
import { useIsMobile } from "@/hooks/useIsMobile";
import { trackEvent } from "@/lib/event-tracker";
import { ViewerBanner } from "@/components/PermissionGuard";
import { WorkCreatedGuide }   from "@/components/onboarding/WorkCreatedGuide";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";
import { WorkLimitCard } from "@/components/upgrade/WorkLimitCard";
import {
  PLAN_DESCRIPTIONS,
  PLAN_LABELS,
} from "@/lib/constants/plans";
import { useAccessPreview } from "@/hooks/useAccessPreview";
import { StatusBadge } from "@/components/shared";
import { isSpreadsheetImportEnabled } from "@/lib/spreadsheet-import/ui-text";
import { computeWorkTopAlerts, type WorkTopAlertTone } from "@/lib/work-top-alerts";
import type { Role } from "@/lib/types/permissions";

// ── ステータス → shared/StatusBadge tone マッピング ───────────────
// (= Phase 3.3a でローカル STATUS_META を撤廃、shared/StatusBadge に統合)
// 表示文言は既存の「下書き / 公開中 / 停止中」を維持。
const STATUS_LABEL: Record<string, string> = {
  draft:  "下書き",
  active: "公開中",
  paused: "停止中",
};
function statusTone(status: string): "active" | "muted" | "warn" {
  if (status === "active") return "active";
  if (status === "paused") return "warn";
  return "muted"; // draft / unknown
}

// ── ダッシュボード用ヘルパー ────────────────────────────────
// 作品トップは「各機能への遷移ハブ」ではなく「状態確認ダッシュボード」。機能一覧の遷移は
// 左サイドバーが担う（重複回避）。ここでは状態表示・注意アラート・最小限のクイック操作に絞る。

const ROLE_LABELS: Record<Role, string> = {
  owner:  "オーナー",
  admin:  "管理者",
  editor: "編集者",
  tester: "テスター",
  viewer: "閲覧者",
};

// アラートのトーン別スタイル（赤一色にせず warning / info / success で優先度を分ける）。
const ALERT_TONE_STYLE: Record<WorkTopAlertTone, { card: string; dot: string; icon: string }> = {
  warning: { card: "border-warn/30 bg-warn-soft",   dot: "bg-warn",    icon: "⚠" },
  info:    { card: "border-sky-200 bg-sky-soft",    dot: "bg-sky-500", icon: "ℹ" },
  success: { card: "border-brand/30 bg-brand-soft", dot: "bg-brand",   icon: "✓" },
};


// （「次の操作」ショートカット行の削除に伴い、その並び替え/強調ロジック・型・スタイル定義
//   〔resolveActions / BASE_ACTIONS / ACTION_EMPHASIS_STYLE / ActionKey 等〕も削除した。
//   管理メニューカードはこれらに依存しない。）

// ── コンポーネント ────────────────────────────────────────
export default function WorkHubPage() {
  const params       = useParams<{ id: string; workId: string }>();
  const searchParams = useSearchParams();
  const oaId   = params.id;
  const workId = params.workId;
  const sp = useIsMobile();
  const { role } = useWorkspaceRole(oaId);
  // 表示確認モードに追随したプラン表示情報を取得 (= 価格・上限・アップグレード訴求を preview tier で確認可能)。
  const { maxWorks, planDisplayName, planName } = useEffectivePlanInfo(oaId);
  // 既存 plan.name (e.g. "tester" / "editor") を 4 段階ティアに正規化する。
  // Subscription 未設定 (= planName=null) は基本 Basic 扱いで安全側 fallback。
  //
  // owner が「表示確認モード」で other plan を選んでいる場合は、
  // effectivePlan を使う (= UI 上だけ override される。API には影響しない)。
  const { effectivePlan: planTier, isPreviewingPlan } = useAccessPreview(oaId);

  const [oaTitle,          setOaTitle]          = useState("");
  const [work,             setWork]             = useState<WorkListItem | null>(null);
  const [phaseCount,       setPhaseCount]       = useState(0);
  const [transCount,       setTransCount]       = useState(0);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState<string | null>(null);
  const [showCreated,      setShowCreated]      = useState(false);
  // tester ロール向けプレビュー後アップグレードカード（dismissable）
  const [showUpgradeCard,  setShowUpgradeCard]  = useState(false);

  // ?created=1 のとき初回バナーを表示
  useEffect(() => {
    if (searchParams.get("created") === "1") setShowCreated(true);
  }, [searchParams]);

  // ロード完了後にセットアップが未完了なら onboarding_blocked を記録
  // work が確定し、loading が false になったタイミングで1回だけ発火
  useEffect(() => {
    if (loading || !work) return;
    const hasChars  = (work._count.characters ?? 0) > 0;
    const hasPhs    = phaseCount > 0;
    const hasMsgs   = (work._count.messages   ?? 0) > 0;
    const hasTrans  = transCount > 0;
    if (hasChars && hasPhs && hasMsgs && hasTrans) return; // セットアップ完了 → ログ不要

    const blockedStep =
      !hasChars ? "character" :
      !hasPhs   ? "phase"     :
      !hasMsgs  ? "message"   : "transition";

    trackEvent(
      "onboarding_blocked",
      { step: blockedStep, reason: "setup_incomplete", work_id: workId },
      { token: getDevToken(), oa_id: oaId },
    );
  // work / phaseCount / transCount が確定したタイミングで実行
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, work, phaseCount, transCount]);

  useEffect(() => {
    const token = getDevToken();

    // ページ表示ログ
    trackEvent("screen_view", { page: "/oas/[id]/works/[workId]" }, { token, oa_id: oaId });
    trackEvent("flow_step",   { step: "hub", work_id: workId },      { token, oa_id: oaId });

    Promise.all([
      oaApi.get(token, oaId),
      workApi.get(token, workId),
      phaseApi.list(token, workId),
      transitionApi.listByWork(token, workId),
    ])
      .then(([oa, w, phases, transitions]) => {
        setOaTitle(oa.title);
        setWork(w);
        // global フェーズは除外してカウント
        setPhaseCount(phases.filter((p: { phase_type: string }) => p.phase_type !== "global").length);
        setTransCount(transitions.length);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [oaId, workId]);

  if (loading) {
    return (
      <div className="mb-5 w-full max-w-[720px] rounded-card border border-line bg-surface p-5 shadow-sm">
        <div className="skeleton mb-2" style={{ width: 200, height: 13, borderRadius: 4 }} />
        <div className="skeleton" style={{ width: 280, height: 22, borderRadius: 4 }} />
      </div>
    );
  }

  if (error) {
    return (
      <>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-round text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
            作品
          </h2>
          <Link
            href={`/oas/${oaId}/works`}
            className="inline-flex items-center justify-center rounded-full border border-line bg-surface px-4 py-1.5 text-[12px] font-bold text-ink-2 no-underline transition-colors hover:border-brand hover:bg-brand-mist hover:text-brand-ink"
          >
            ← 作品リストに戻る
          </Link>
        </div>
        <div
          role="alert"
          className="rounded-field border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] leading-[1.6] text-danger"
        >
          {error}
        </div>
      </>
    );
  }

  // ── オンボーディング判定 ─────────────────────────────
  const hasCharacters  = (work?._count.characters ?? 0) > 0;
  const hasPhases      = phaseCount > 0;
  const hasMessages    = (work?._count.messages   ?? 0) > 0;
  const hasTransitions = transCount > 0;


  const currentStatus    = work?.publish_status ?? "draft";
  const currentStatusLabel = STATUS_LABEL[currentStatus] ?? currentStatus;
  const basePath   = `/oas/${oaId}/works/${workId}`;

  // ── ダッシュボード派生値（既存データのみ・新規 API なし）──
  const roleLabel = role ? (ROLE_LABELS[role] ?? role) : "—";
  const alerts = computeWorkTopAlerts({
    publishStatus:   currentStatus,
    hasStartTrigger: !!work?.start_trigger,
    characters:      work?._count.characters ?? 0,
    phases:          phaseCount,
    messages:        work?._count.messages ?? 0,
    basePath,
  });
  // よく使う操作（サイドバーと完全重複する一覧導線は避け、作業開始に直結する操作に絞る・最大5個）。
  const quickActions: { label: string; href: string }[] = [
    { label: "メッセージを追加", href: `${basePath}/messages` },
    { label: "フェーズを追加",   href: `${basePath}/scenario` },
    { label: "プレビュー",       href: `/playground?work_id=${workId}&oa_id=${oaId}` },
    ...(role !== "tester" ? [{ label: "作品設定", href: `${basePath}/edit` }] : []),
    ...(isSpreadsheetImportEnabled() ? [{ label: "スプレッドシート取込", href: `${basePath}/messages/import` }] : []),
  ].slice(0, 5);

  // updated_at フォーマット（WorkCard と同形式）
  function formatDate(iso: string) {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  }

  // （「次の操作」ショートカット行の削除に伴い、その preview クリックハンドラ・クリック計測
  //   〔handlePreviewClick / trackHubActionClick〕と並び替え結果〔resolvedActions〕も削除した。）

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
        <Breadcrumb items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "作品リスト",       href: `/oas/${oaId}/works` },
          ...(work ? [{ label: work.title }] : []),
        ]} />

        {/* タイトル行 */}
        <div className="mt-1 flex flex-wrap items-center gap-2.5">
          <h2 className="font-round m-0 overflow-hidden text-ellipsis whitespace-nowrap text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink max-w-[200px] sm:max-w-[400px]">
            {work?.title ?? "作品"}
          </h2>
          {/* ステータスバッジ — shared/StatusBadge に統合 (Phase 3.3a) */}
          {work?.publish_status && (
            <StatusBadge tone={statusTone(currentStatus)}>
              {currentStatusLabel}
            </StatusBadge>
          )}
        </div>

        {/* サブ情報行: 開始トリガー / 最終更新 */}
        <div className="mt-2 flex flex-wrap items-center gap-y-1.5 gap-x-4">
          {/* 開始トリガー */}
          <div className="flex items-center gap-1.5">
            <span className="flex-shrink-0 select-none text-[10px] font-bold uppercase tracking-[0.07em] text-ink-3">
              開始トリガー
            </span>
            {work?.start_trigger ? (
              <span
                className="max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap rounded-full border border-line bg-bg-tint px-2.5 py-0.5 font-mono text-[12px] font-medium text-ink sm:max-w-[260px]"
                title={work.start_trigger}
              >
                {work.start_trigger}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[12px] italic text-ink-2">
                <span aria-hidden="true" className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-warn" />
                未設定
              </span>
            )}
          </div>

          {/* 最終更新日 */}
          {work?.updated_at && (
            <time dateTime={work.updated_at} className="font-num text-[11px] text-ink-3">
              更新 {formatDate(work.updated_at)}
            </time>
          )}
        </div>

        {/* 説明文 */}
        {work?.description && (
          <p className="mt-1.5 text-[13px] leading-[1.6] text-ink-2">
            {work.description}
          </p>
        )}
        </div>

        {/* OA 単位の共通導線（プラン / 設定）。作品固有アクションとは分けて右上に配置。
            作品リストと見た目・並びを統一。設定は tester ロールには出さない（既存挙動踏襲）。 */}
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <OaHeaderActions
            oaId={oaId}
            planName={planName ?? undefined}
            source="work_detail"
            showSettings={role !== "tester"}
          />
        </div>
      </div>

      {/* ── 閲覧専用バナー ── */}
      <ViewerBanner role={role} />

      {/* ── 作品数上限プラン向けプレビュー後アップグレード誘導 ── */}
      {showUpgradeCard && (
        <WorkLimitCard
          variant="preview"
          onDismiss={() => setShowUpgradeCard(false)}
          maxWorks={maxWorks ?? undefined}
          planDisplayName={planDisplayName ?? undefined}
          planName={planName ?? undefined}
        />
      )}

      {/* ══ オンボーディング UI ══════════════════════════════
          優先順位:
            1. 作成直後バナー（?created=1）— WorkCreatedGuide
            2. 初回進捗ステッパー          — OnboardingProgress
      ══════════════════════════════════════════════════════ */}
      {showCreated && work ? (
        <WorkCreatedGuide
          oaId={oaId}
          workId={workId}
          hasCharacters={hasCharacters}
          hasPhases={hasPhases}
          hasMessages={hasMessages}
          hasTransitions={hasTransitions}
          onDismiss={() => setShowCreated(false)}
        />
      ) : (
        <OnboardingProgress
          oaId={oaId}
          workId={workId}
          hasCharacters={hasCharacters}
          hasPhases={hasPhases}
          hasMessages={hasMessages}
          hasTransitions={hasTransitions}
        />
      )}

      {/* ── 注意が必要な項目（トーン別・強すぎない見た目）── */}
      {work && (
        <div className="mb-6 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-ink-3">
              状態と注意点
            </span>
            <div aria-hidden="true" className="h-px flex-1 bg-line" />
            {/* 実行プラン / 実権限（既存データ）*/}
            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-bg-tint px-2.5 py-0.5 text-[11px] text-ink-2">
              プラン <strong className="text-ink">{PLAN_LABELS[planTier]}</strong>
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-bg-tint px-2.5 py-0.5 text-[11px] text-ink-2">
              権限 <strong className="text-ink">{roleLabel}</strong>
            </span>
          </div>
          {alerts.map((a) => {
            const s = ALERT_TONE_STYLE[a.tone];
            return (
              <div key={a.key} className={"flex items-start gap-2.5 rounded-card border px-3.5 py-2.5 " + s.card}>
                <span aria-hidden="true" className={"mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white " + s.dot}>
                  {s.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold text-ink">{a.title}</div>
                  <div className="mt-0.5 text-[12px] leading-[1.6] text-ink-2">{a.detail}</div>
                </div>
                {a.cta && (
                  <Link href={a.cta.href} className="flex-shrink-0 self-center whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink no-underline transition-colors hover:border-brand/40 hover:text-brand-ink">
                    {a.cta.label}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── 使い方ガイド ── */}
      <HelpAccordion items={[
        { title: "この画面でできること", points: [
          "シナリオを構成するキャラクター・フェーズ・メッセージをまとめて管理できます",
          "公開ステータスの変更や、プレビュー機能への起点になります",
        ]},
        { title: "まず最初に決めること", points: [
          "1. キャラクターを作成（送信者の名前・アイコン）",
          "2. フェーズを作成（開始・通常・エンディング）",
          "3. メッセージを追加してフェーズに紐づける",
          "4. フェーズ管理で遷移（分岐）を設定する",
        ]},
        { title: "注意点", points: [
          "公開ステータスが「公開中」のときだけ LINE からのメッセージに反応します",
          "公開前に必ずプレビュー機能でシナリオの動作を確認してください",
        ]},
      ]} />

      {/* ── カウント表示 ── */}
      {work && (
        <div className="mb-6 overflow-hidden rounded-card border border-line bg-surface shadow-sm">
          {/* 上段: 構成要素カウント */}
          <div className="flex flex-wrap gap-3 p-3.5 sm:gap-2.5 sm:px-5 sm:py-4">
            {[
              { label: "プレイヤー",   value: (work.progress_stats?.total ?? 0).toLocaleString(), highlight: (work.progress_stats?.total ?? 0) > 0 },
              { label: "キャラクター", value: work._count.characters.toLocaleString(), highlight: false },
              { label: "フェーズ",     value: phaseCount.toLocaleString(),             highlight: false },
              { label: "メッセージ",   value: work._count.messages.toLocaleString(),   highlight: false },
            ].map(({ label, value, highlight }, i, arr) => (
              <div
                key={label}
                className={
                  "flex items-center gap-2 " +
                  "sm:pr-5 " +
                  (i < arr.length - 1 ? "sm:border-r sm:border-line-2" : "")
                }
              >
                <span
                  className={
                    "font-num text-[18px] font-extrabold leading-none sm:text-[20px] " +
                    (highlight ? "text-sky-ink" : "text-ink")
                  }
                >
                  {value}
                </span>
                <span className="text-[11px] text-ink-3">{label}</span>
              </div>
            ))}
          </div>

          {/* 下段: 進行サマリー — プレイヤーが1人以上いる場合のみ表示 */}
          {(work.progress_stats?.total ?? 0) > 0 && (() => {
            const completed  = work.progress_stats?.completed   ?? 0;
            const inProgress = work.progress_stats?.in_progress ?? 0;
            const needsCheck = inProgress > 0 && completed === 0;
            return (
              <div className="flex flex-wrap items-center gap-2 border-t border-line-2 px-3.5 pb-3 pt-2 sm:px-5 sm:pb-3 sm:pt-2">
                {/* 完了チップ — brand トーン (= WorkCard と同) */}
                <span
                  className={
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] " +
                    (completed > 0
                      ? "border-brand/30 bg-brand-soft text-brand-ink"
                      : "border-line bg-bg-tint text-ink-3")
                  }
                >
                  <strong className="font-num font-bold">{completed.toLocaleString()}</strong>
                  <span className={completed > 0 ? "text-brand-ink/85" : "text-ink-3"}>完了</span>
                </span>

                {/* 進行中チップ — gray 系 (= WorkCard と同) */}
                <span className="inline-flex items-center gap-1 rounded-full border border-line bg-bg-tint px-2.5 py-0.5 text-[12px] text-ink-2">
                  <span aria-hidden="true" className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink-3" />
                  <strong className="font-num font-bold">{inProgress.toLocaleString()}</strong>
                  <span className="text-ink-3">進行中</span>
                </span>

                {/* 「要確認」補助ラベル — WorkCard と同条件・同トーン */}
                {needsCheck && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 text-[11px] text-warn">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      aria-hidden="true">
                      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                      <line x1="4" y1="22" x2="4" y2="15" />
                    </svg>
                    完了者未発生
                  </span>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── よく使う操作（サイドバーと重複しない、作業開始に直結する操作のみ）── */}
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex-shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-ink-3">
          よく使う操作
        </span>
        <div aria-hidden="true" className="h-px flex-1 bg-line" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {quickActions.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="inline-flex items-center gap-1.5 rounded-card border border-line bg-surface px-3.5 py-2 text-[13px] font-semibold text-ink no-underline shadow-sm transition-all hover:-translate-y-px hover:border-brand/30 hover:text-brand-ink hover:shadow-card"
          >
            {a.label}
            <span aria-hidden="true" className="text-ink-3">›</span>
          </Link>
        ))}
      </div>

      {/* プラン説明文 (= 管理メニュー下部) — 表示確認中は背景を変えて区別 */}
      <div
        className={
          "mt-3.5 rounded-card border px-3.5 py-2.5 text-[12px] leading-[1.7] text-ink-2 " +
          (isPreviewingPlan
            ? "border-warn/30 bg-warn-soft"
            : "border-line bg-bg-tint")
        }
      >
        <span className="mr-2 font-bold text-ink">
          {isPreviewingPlan ? "表示確認中のプラン" : "現在のプラン"}: {PLAN_LABELS[planTier]}
        </span>
        {PLAN_DESCRIPTIONS[planTier]}
      </div>
    </>
  );
}
