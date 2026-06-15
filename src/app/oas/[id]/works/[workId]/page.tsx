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
  HUB_CARD_TO_FEATURE,
  PLAN_DESCRIPTIONS,
  PLAN_LABELS,
  getPlanAccessState,
} from "@/lib/constants/plans";
import { useAccessPreview } from "@/hooks/useAccessPreview";
import { withPreviewParams } from "@/lib/access-preview";
import { StatusBadge, PlanTag } from "@/components/shared";

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

// ── ハブカード定義 ────────────────────────────────────────
// Phase 3.3c: per-feature vivid 色 (color / bg) を撤廃 (= ガイド §1.1「brand 緑は主役アクション専用」)。
// uniform card + hover brand アクセント (= OA settings hub Phase 1.4 と同方針)。
// key / title / desc / 表示順 / featureKey 連携 (HUB_CARD_TO_FEATURE) は完全維持。
const HUB_CARDS = [
  { key: "edit",         title: "作品情報",       desc: "作品名や説明などの基本情報を編集します" },
  { key: "characters",   title: "キャラクター",   desc: "メッセージ送信者となるキャラクターを管理します" },
  { key: "messages",     title: "メッセージ",     desc: "フェーズごとに送信するメッセージ・謎チャレンジを管理します" },
  { key: "scenario",     title: "フェーズ管理",   desc: "フェーズの追加・並び替えと遷移フローを管理します" },
  { key: "audience",     title: "オーディエンス", desc: "プレイ統計・フロー・セグメントなどを確認します" },
  { key: "liff",         title: "LIFF設定",       desc: "LIFFページのブロックを追加・編集・並び替えます" },
  { key: "locations",    title: "ロケーション",   desc: "GPS・ビーコン・QRで現地発火するトリガーを管理します" },
  { key: "x-posts",      title: "X投稿管理",      desc: "作品の告知ポスト、投稿URL、クリック計測、CSV分析を管理します" },
] as const;

// ── ハブカード / アクションアイコン（SVGで役割を示す） ──────────
// Phase 3.3c: color 引数を撤廃し currentColor ベースに変更。
// 親要素の Tailwind text-* class でアイコン色を制御する。
function HubCardIcon({ cardKey }: { cardKey: string }) {
  const p = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none" as const, stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (cardKey === "edit") return (
    <svg {...p} aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
  if (cardKey === "characters") return (
    <svg {...p} aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
  if (cardKey === "messages") return (
    <svg {...p} aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
  if (cardKey === "scenario") return (
    <svg {...p} aria-hidden="true">
      <circle cx="18" cy="18" r="3"/>
      <circle cx="6" cy="6" r="3"/>
      <path d="M13 6h3a2 2 0 0 1 2 2v7"/>
      <line x1="6" y1="9" x2="6" y2="21"/>
    </svg>
  );
  if (cardKey === "audience") return (
    <svg {...p} aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  );
  if (cardKey === "liff") return (
    <svg {...p} aria-hidden="true">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
      <line x1="12" y1="18" x2="12" y2="18"/>
    </svg>
  );
  if (cardKey === "locations") return (
    <svg {...p} aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  );
  if (cardKey === "destinations") return (
    <svg {...p} aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  );
  if (cardKey === "preview") return (
    <svg {...p} aria-hidden="true">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  );
  if (cardKey === "x-posts") return (
    <svg {...p} aria-hidden="true">
      <path d="M4 4l16 16M20 4L4 20"/>
    </svg>
  );
  return null;
}

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

      {/* ── ハブカード（全機能の見取り図） ── */}
      {/* 上部アクション行との役割分離: ハブカードは機能一覧・補助導線として機能する */}
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex-shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-ink-3">
          管理メニュー
        </span>
        <div aria-hidden="true" className="h-px flex-1 bg-line" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(270px,1fr))] sm:gap-3.5">
        {HUB_CARDS.map((card) => {
          // プランによる利用可否を判定。featureKey が未マップの card は安全側で「許可」扱い (= 制限しない)。
          const featureKey = HUB_CARD_TO_FEATURE[card.key];
          const access = featureKey
            ? getPlanAccessState({ plan: planTier, featureKey })
            : ({ allowed: true, reason: "allowed", message: "" } as const);

          // カード本体 (= 共通の中身レンダリング)
          // Phase 3.3c: per-feature 色を撤廃、uniform card + hover brand アクセント
          const cardBody = (
            <div
              className={
                "group flex h-full items-center gap-3.5 rounded-card border bg-surface px-4 py-4 shadow-sm transition-all " +
                (access.allowed
                  ? "cursor-pointer border-line hover:-translate-y-px hover:border-brand/30 hover:shadow-card"
                  : "cursor-not-allowed border-line bg-bg-tint opacity-70")
              }
            >
              {/* アイコン枠 (= uniform、アイコン色は currentColor で text-* から継承) */}
              <div
                className={
                  "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-line bg-bg-tint transition-colors " +
                  (access.allowed ? "text-ink-3 group-hover:bg-brand-soft group-hover:text-brand-ink" : "text-ink-3")
                }
              >
                <HubCardIcon cardKey={card.key} />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={
                    "mb-0.5 text-[14px] font-bold transition-colors " +
                    (access.allowed ? "text-ink group-hover:text-brand-ink" : "text-ink-2")
                  }
                >
                  {card.title}
                </div>
                <div className="text-[12px] leading-[1.55] text-ink-2 line-clamp-2 min-h-[37px]">
                  {card.desc}
                </div>
                {/* プラン制限がかかっている場合、必要プラン表記を <PlanTag> で表示 */}
                {!access.allowed && access.reason === "plan_required" && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <PlanTag plan={access.requiredPlanLabel} />
                    <span className="text-[11px] text-ink-3">で利用できます</span>
                  </div>
                )}
              </div>
              <span
                aria-hidden="true"
                className={
                  "flex-shrink-0 self-center text-[16px] transition-colors " +
                  (access.allowed ? "text-ink-3 group-hover:text-brand-ink" : "text-ink-3/40")
                }
              >
                ›
              </span>
            </div>
          );

          // 利用可: 通常通り Link でラップ。
          // owner の表示確認モード中は previewPlan / previewRole を href に持ち越す
          // (= 遷移先でも同じ preview 状態を維持するため)。
          if (access.allowed) {
            // ロケーションは OA レベルの統合管理（/oas/[id]/locations）へ寄せる。
            // workId を引き継いで該当作品で絞り込んだ状態で開く。既存の作品スコープ画面
            // (/oas/[id]/works/[workId]/locations 等) は当面残置（直リンク・既存導線は不変）。
            const cardBase = card.key === "locations"
              ? `/oas/${oaId}/locations?workId=${workId}`
              : `/oas/${oaId}/works/${workId}/${card.key}`;
            const cardHref = withPreviewParams(cardBase, searchParams);
            return (
              <Link
                key={card.key}
                href={cardHref}
                className="block h-full no-underline"
              >
                {cardBody}
              </Link>
            );
          }

          // 利用不可: href / onClick を付けず、aria-disabled / tabIndex=-1 で操作不能にする。
          // クリックさせない (= ユーザーに「使えませんでした」体験をさせない) のがポイント。
          // role="link" を付けないことで SR でリンク扱いされず、無駄な遷移を促さない。
          return (
            <div
              key={card.key}
              role="group"
              aria-disabled={true}
              aria-label={`${card.title} (${access.reason === "plan_required" ? access.requiredPlanLabel + "プランで利用できます" : "利用できません"})`}
              tabIndex={-1}
              className="block h-full no-underline"
            >
              {cardBody}
            </div>
          );
        })}
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
