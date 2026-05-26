"use client";

// src/app/oas/[id]/works/[workId]/page.tsx
// 作品ハブ — 各管理機能へのナビゲーション

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { workApi, oaApi, phaseApi, transitionApi, onboardingApi, getDevToken } from "@/lib/api-client";
import type { WorkListItem } from "@/lib/api-client";
import { HelpAccordion } from "@/components/HelpAccordion";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useWorkLimit } from "@/hooks/useWorkLimit";
import { useIsMobile } from "@/hooks/useIsMobile";
import { trackEvent } from "@/lib/event-tracker";
import { ViewerBanner } from "@/components/PermissionGuard";
import { WorkCreatedGuide }   from "@/components/onboarding/WorkCreatedGuide";
import { NextActionCard }     from "@/components/onboarding/NextActionCard";
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
import { StatusBadge } from "@/components/shared";

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
const HUB_CARDS = [
  {
    key:   "edit",
    title: "作品情報",
    desc:  "タイトル・説明・公開ステータス・あいさつメッセージを編集します",
    color: "#374151",
    bg:    "#f9fafb",
  },
  {
    key:   "characters",
    title: "キャラクター",
    desc:  "メッセージ送信者となるキャラクターを管理します",
    color: "#7c3aed",
    bg:    "#f5f3ff",
  },
  {
    key:   "messages",
    title: "メッセージ・謎",
    desc:  "フェーズごとに送信するメッセージ・謎チャレンジを管理します",
    color: "#06C755",
    bg:    "#E6F7ED",
  },
  {
    key:   "scenario",
    title: "シナリオフロー",
    desc:  "フェーズの追加・並び替え・編集と遷移フローを1画面で管理します",
    color: "#059669",
    bg:    "#ecfdf5",
  },
  {
    key:   "audience",
    title: "オーディエンス",
    desc:  "プレイ統計・リアルタイム・フロー・セグメント・トラッキングを確認します",
    color: "#0891b2",
    bg:    "#ecfeff",
  },
  {
    key:   "liff",
    title: "LIFF表示設定",
    desc:  "LIFFページに表示するブロックの追加・編集・並び替えを行います",
    color: "#8b5cf6",
    bg:    "#f5f3ff",
  },
  {
    key:   "locations",
    title: "ロケーション",
    desc:  "GPS・ビーコン・QRを使って、現地で発火する体験トリガーを管理します",
    color: "#dc2626",
    bg:    "#fef2f2",
  },
  {
    key:   "destinations",
    title: "遷移先URL設定",
    desc:  "リッチメニューやメッセージから飛ばすURLを一元管理します",
    color: "#0d9488",
    bg:    "#f0fdfa",
  },
] as const;

// ── ハブカード / アクションアイコン（SVGで役割を示す） ──────────
function HubCardIcon({ cardKey, color }: { cardKey: string; color: string }) {
  const p = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none" as const, stroke: color, strokeWidth: "1.8", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
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
  return null;
}

// ── 主要アクション — 型定義 ──────────────────────────────────
type ActionKey      = "messages" | "scenario" | "preview" | "characters" | "audience";
// emphasis:
//   "preview" — sky-blue（プレビュー固定トーン）
//   "warning" — amber（要確認を促す状態で付与）
//   "normal"  — neutral（デフォルト）
type ActionEmphasis = "preview" | "warning" | "normal";

interface ActionDef {
  key:       ActionKey;
  label:     string;
  isPreview: boolean;
}
interface ResolvedAction extends ActionDef {
  emphasis: ActionEmphasis;
}

// ── ベース定義（デフォルトの並び順） ─────────────────────────
// 状態ベースの並び替えは resolveActions() が担う
const BASE_ACTIONS: readonly ActionDef[] = [
  { key: "messages",   label: "メッセージ",   isPreview: false },
  { key: "scenario",   label: "シナリオ",     isPreview: false },
  { key: "preview",    label: "プレビュー",   isPreview: true  },
  { key: "characters", label: "キャラクター", isPreview: false },
  { key: "audience",   label: "分析",         isPreview: false },
];

// ── 状態ベースの並び替え・強調ロジック ───────────────────────
// priority 数値が小さいほど前に表示される（デフォルト = 配列インデックス順）
// 将来の拡張: このルールセットに条件を追加するだけでよい
interface ResolveActionsParams {
  status:     string;  // publish_status
  hasTrigger: boolean; // start_trigger が設定済みか
  players:    number;  // 総プレイヤー数（isPreview:false のみ）
  inProgress: number;  // 進行中ユーザー数
  completed:  number;  // 完了ユーザー数
}

function resolveActions({
  status, hasTrigger, players, inProgress, completed,
}: ResolveActionsParams): ResolvedAction[] {
  const priority: Record<ActionKey, number> = {
    messages:   0,
    scenario:   1,
    preview:    2,
    characters: 3,
    audience:   4,
  };
  // warning 強調が必要なキーを収集
  const warned = new Set<ActionKey>();

  // ── Rule 1: 開始トリガー未設定 → メッセージを最優先
  //    トリガーがないと LINE 側でシナリオを起動できない。
  //    まずコンテンツ（メッセージ）を整えてからトリガーを設定する流れを支援する。
  if (!hasTrigger) {
    priority.messages = -1;
  }

  // ── Rule 2: draft → 編集系（メッセージ・シナリオ・プレビュー）を前面に
  //    公開前は完成度を上げるフェーズ。コンテンツ編集と動作確認を優先する。
  //    分析は後ろへ（draft 中はデータが少なく見ても参考にならない）。
  if (status === "draft") {
    priority.messages  = Math.min(priority.messages, 0);
    priority.scenario  = Math.min(priority.scenario, 1);
    priority.preview   = Math.min(priority.preview,  2);
    priority.audience  = 4;
  }

  // ── Rule 3: active → 分析を少し上げる
  //    運用フェーズではプレイヤーの動向把握が重要になるため。
  if (status === "active") {
    priority.audience = Math.min(priority.audience, 2);
  }

  // ── Rule 4: プレイヤー数 0 → プレビューを前に上げる
  //    誰も体験していない = まず動作確認を促す。
  if (players === 0) {
    priority.preview = Math.min(priority.preview, 1);
  }

  // ── Rule 5: 進行中ありで完了者ゼロ → シナリオ・分析を上げて amber 強調
  //    エンディングに到達できていない = シナリオフローに問題がある可能性。
  //    "要確認" として視覚的に訴求する（amber は既存の warning トーンと統一）。
  if (inProgress > 0 && completed === 0) {
    priority.scenario = Math.min(priority.scenario, 0.5);
    priority.audience = Math.min(priority.audience, 1.5);
    warned.add("scenario");
    warned.add("audience");
  }

  return [...BASE_ACTIONS]
    .sort((a, b) => priority[a.key] - priority[b.key])
    .map((a): ResolvedAction => ({
      ...a,
      // preview は常に sky-blue / warned に入ったキーは amber / それ以外は neutral
      emphasis: a.isPreview ? "preview" : warned.has(a.key) ? "warning" : "normal",
    }));
}

// ── アクション emphasis ごとのスタイル定義 ───────────────────
const ACTION_EMPHASIS_STYLE: Record<
  ActionEmphasis,
  { color: string; background: string; borderColor: string; hoverBg: string; hoverBorder: string; iconColor: string }
> = {
  preview: {
    color:       "#0369a1",
    background:  "#f0f9ff",
    borderColor: "#bae6fd",
    hoverBg:     "#e0f2fe",
    hoverBorder: "#7dd3fc",
    iconColor:   "#0369a1",
  },
  // 要確認トーン — WorkCard / ハブの "完了者未発生" と同トーン
  warning: {
    color:       "#b45309",
    background:  "#fffbeb",
    borderColor: "#fde68a",
    hoverBg:     "#fef3c7",
    hoverBorder: "#fcd34d",
    iconColor:   "#b45309",
  },
  normal: {
    color:       "var(--text-secondary, #374151)",
    background:  "var(--surface)",
    borderColor: "var(--border-light)",
    hoverBg:     "var(--gray-100, #f3f4f6)",
    hoverBorder: "var(--gray-300, #d1d5db)",
    iconColor:   "var(--text-muted)",
  },
} as const;

// ── コンポーネント ────────────────────────────────────────
export default function WorkHubPage() {
  const params       = useParams<{ id: string; workId: string }>();
  const searchParams = useSearchParams();
  const oaId   = params.id;
  const workId = params.workId;
  const sp = useIsMobile();
  const { role } = useWorkspaceRole(oaId);
  const { maxWorks, planDisplayName, planName } = useWorkLimit(oaId);
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
  const isSetupIncomplete = !hasCharacters || !hasPhases || !hasMessages || !hasTransitions;


  const currentStatus    = work?.publish_status ?? "draft";
  const currentStatusLabel = STATUS_LABEL[currentStatus] ?? currentStatus;
  const basePath   = `/oas/${oaId}/works/${workId}`;

  // updated_at フォーマット（WorkCard と同形式）
  function formatDate(iso: string) {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  }

  // プレビュー共通クリックハンドラ（主要アクション行から呼ばれる）
  function handlePreviewClick() {
    try { localStorage.setItem(`preview-confirmed-${workId}`, "1"); } catch {}
    onboardingApi.trackStep(getDevToken(), { work_id: workId, oa_id: oaId, step: "previewed" }).catch(() => {});
    if (maxWorks !== null && maxWorks !== -1) setShowUpgradeCard(true);
  }

  // ── 主要アクション クリック計測 ─────────────────────────────
  // fire-and-forget — 計測失敗時でも遷移・操作は通常通り動く。
  //
  // 分析ポイント（後からクエリで確認できること）:
  //   - 最もクリックされる action_key は何か
  //   - emphasis="warning" 付与で scenario/audience の CTR が上がるか
  //     → Rule5（inProgress>0 && completed=0）の施策効果を検証
  //   - players=0 のとき preview を上位に出す判断が効いているか
  //     → position_index と CTR の相関を見る
  //   - status="active" 時に audience を上げた効果の検証
  //
  // 計測先: event_logs テーブル（既存の汎用イベントログ基盤）
  // イベント名: "hub_action_click"  /  ペイロード型: HubActionClickPayload
  function trackHubActionClick(action: ResolvedAction, positionIndex: number): void {
    trackEvent(
      "hub_action_click",
      {
        action_key:        action.key,
        emphasis:          action.emphasis,
        position_index:    positionIndex,
        source:            "work_hub_primary_actions",
        status:            work?.publish_status              ?? "draft",
        has_start_trigger: !!work?.start_trigger,
        players:           work?._count.userProgress         ?? 0,
        completed:         work?.progress_stats?.completed   ?? 0,
        in_progress:       work?.progress_stats?.in_progress ?? 0,
        work_id:           workId,
      },
      { token: getDevToken(), oa_id: oaId },
    );
  }

  // 状態ベースの主要アクション並び替え・強調
  // work が null のときはデフォルト順（ローディング後には再計算される）
  const resolvedActions = resolveActions({
    status:     work?.publish_status         ?? "draft",
    hasTrigger: !!work?.start_trigger,
    players:    work?._count.userProgress    ?? 0,
    inProgress: work?.progress_stats?.in_progress ?? 0,
    completed:  work?.progress_stats?.completed   ?? 0,
  });

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="mb-5 min-w-0">
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
            3. 次アクションカード          — NextActionCard（setup 未完了時のみ）
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
        <>
          <OnboardingProgress
            oaId={oaId}
            workId={workId}
            hasCharacters={hasCharacters}
            hasPhases={hasPhases}
            hasMessages={hasMessages}
            hasTransitions={hasTransitions}
          />
          {isSetupIncomplete && (
            <NextActionCard
              oaId={oaId}
              workId={workId}
              hasCharacters={hasCharacters}
              hasPhases={hasPhases}
            />
          )}
        </>
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
          "4. シナリオフローで遷移（分岐）を設定する",
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
              { label: "プレイヤー",   value: (work._count.userProgress ?? 0).toLocaleString(), highlight: (work._count.userProgress ?? 0) > 0 },
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
          {(work._count.userProgress ?? 0) > 0 && (() => {
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

      {/* ══ 主要アクション行（次の操作への主導線） ═══════════════════
          情報設計: 上部 = 次の一手 / 下部ハブカード = 全機能の見取り図
          ─────────────────────────────────────────────────────────────
          拡張ポイント: 将来は publish_status / setup 状態で順序を変える
            例) active → "audience" 先頭 / draft+未完了 → "messages" 先頭
      ════════════════════════════════════════════════════════════════ */}
      <div style={{
        marginBottom: 20,
        padding:      sp ? "10px 12px" : "10px 16px",
        background:   "var(--gray-50, #f9fafb)",
        border:       "1px solid var(--border-light)",
        borderRadius: "var(--radius-md)",
        display:      "flex",
        alignItems:   "center",
        flexWrap:     "wrap",
        gap:          "8px 8px",
      }}>
        {/* セクションラベル */}
        <span style={{
          fontSize:      10,
          fontWeight:    700,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color:         "var(--text-muted)",
          whiteSpace:    "nowrap",
          flexShrink:    0,
          paddingRight:  6,
        }}>
          次の操作
        </span>

        {/* アクション pill リスト（resolveActions による状態ベースの並び・強調） */}
        {resolvedActions.map((action, idx) => {
          const href   = action.isPreview
            ? `/playground?work_id=${workId}&oa_id=${oaId}`
            : `${basePath}/${action.key}`;
          const es = ACTION_EMPHASIS_STYLE[action.emphasis];
          return (
            <Link
              key={action.key}
              href={href}
              onClick={() => {
                // 計測: fire-and-forget（失敗しても遷移は止まらない）
                trackHubActionClick(action, idx);
                // preview 固有の処理（localStorage 書き込み・onboarding 記録）
                if (action.isPreview) handlePreviewClick();
              }}
              style={{
                display:        "inline-flex",
                alignItems:     "center",
                gap:            5,
                padding:        sp ? "7px 13px" : "6px 13px",
                borderRadius:   "var(--radius-full)",
                fontSize:       13,
                fontWeight:     600,
                color:          es.color,
                background:     es.background,
                border:         `1px solid ${es.borderColor}`,
                textDecoration: "none",
                whiteSpace:     "nowrap",
                transition:     "background 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLAnchorElement;
                el.style.background  = es.hoverBg;
                el.style.borderColor = es.hoverBorder;
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLAnchorElement;
                el.style.background  = es.background;
                el.style.borderColor = es.borderColor;
              }}
            >
              <HubCardIcon cardKey={action.key} color={es.iconColor} />
              {action.label}
            </Link>
          );
        })}
      </div>

      {/* ── ハブカード（全機能の見取り図） ── */}
      {/* 上部アクション行との役割分離: ハブカードは機能一覧・補助導線として機能する */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{
          fontSize:      10,
          fontWeight:    700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color:         "var(--text-muted)",
          whiteSpace:    "nowrap",
          flexShrink:    0,
        }}>
          管理メニュー
        </span>
        <div style={{ flex: 1, height: 1, background: "var(--border-light)" }} aria-hidden="true" />
      </div>

      <div style={{
        display: "grid",
        // SP: 1カラム固定  PC: 270px以上で auto-fill
        gridTemplateColumns: sp ? "1fr" : "repeat(auto-fill, minmax(270px, 1fr))",
        gap: sp ? 10 : 14,
      }}>
        {HUB_CARDS.map((card) => {
          // プランによる利用可否を判定。featureKey が未マップの card は安全側で「許可」扱い (= 制限しない)。
          const featureKey = HUB_CARD_TO_FEATURE[card.key];
          const access = featureKey
            ? getPlanAccessState({ plan: planTier, featureKey })
            : ({ allowed: true, reason: "allowed", message: "" } as const);

          // カード本体 (= 共通の中身レンダリング)
          const cardBody = (
            <div
              style={{
                background:   "var(--surface)",
                border:       "1px solid var(--border-light)",
                borderRadius: "var(--radius-md)",
                padding:      "16px 18px",
                cursor:       access.allowed ? "pointer" : "not-allowed",
                transition:   "box-shadow 0.15s, border-color 0.15s, transform 0.1s",
                display:      "flex",
                alignItems:   "center",
                gap:          14,
                boxShadow:    "var(--shadow-xs)",
                opacity:      access.allowed ? 1 : 0.55,
              }}
              onMouseEnter={access.allowed ? (e) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.boxShadow   = "var(--shadow-md)";
                el.style.borderColor = "var(--gray-300)";
                el.style.transform   = "translateY(-2px)";
              } : undefined}
              onMouseLeave={access.allowed ? (e) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.boxShadow   = "var(--shadow-xs)";
                el.style.borderColor = "var(--border-light)";
                el.style.transform   = "";
              } : undefined}
            >
              {/* カラーアンカー — SVGアイコン入りで各カードの役割を即座に示す */}
              <div style={{
                width:           36,
                height:          36,
                borderRadius:    8,
                background:      card.bg,
                border:          `1px solid ${card.color}40`,
                flexShrink:      0,
                display:         "flex",
                alignItems:      "center",
                justifyContent:  "center",
              }}>
                <HubCardIcon cardKey={card.key} color={card.color} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: card.color, marginBottom: 3 }}>
                  {card.title}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
                  {card.desc}
                </div>
                {/* プラン制限がかかっている場合、必要プラン表記を小さく表示 */}
                {!access.allowed && access.reason === "plan_required" && (
                  <div style={{
                    fontSize: 11, color: "#92400e", marginTop: 4,
                    background: "#fffbeb", border: "1px solid #fde68a",
                    borderRadius: 4, padding: "2px 6px", display: "inline-block",
                  }}>
                    {access.requiredPlanLabel}プラン以上で利用できます
                  </div>
                )}
              </div>
              <span style={{
                color: access.allowed ? "var(--text-muted)" : "#cbd5e1",
                fontSize: 16, alignSelf: "center", flexShrink: 0,
              }}>›</span>
            </div>
          );

          // 利用可: 通常通り Link でラップ。
          // owner の表示確認モード中は previewPlan / previewRole を href に持ち越す
          // (= 遷移先でも同じ preview 状態を維持するため)。
          if (access.allowed) {
            const cardHref = withPreviewParams(
              `/oas/${oaId}/works/${workId}/${card.key}`,
              searchParams,
            );
            return (
              <Link
                key={card.key}
                href={cardHref}
                style={{ textDecoration: "none" }}
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
              aria-label={`${card.title} (${access.reason === "plan_required" ? access.requiredPlanLabel + "プラン以上で利用できます" : "利用できません"})`}
              tabIndex={-1}
              style={{ textDecoration: "none" }}
            >
              {cardBody}
            </div>
          );
        })}
      </div>

      {/* プラン説明文 (= 管理メニュー下部) — 表示確認中は背景を変えて区別 */}
      <div style={{
        marginTop: 14,
        padding: "10px 14px",
        background:   isPreviewingPlan ? "#fffbeb" : "#f8fafc",
        border:       `1px solid ${isPreviewingPlan ? "#fde68a" : "var(--border-light)"}`,
        borderRadius: "var(--radius-md)",
        fontSize:     12,
        color:        "var(--text-secondary)",
        lineHeight:   1.7,
      }}>
        <span style={{ fontWeight: 700, color: "var(--text-primary)", marginRight: 8 }}>
          {isPreviewingPlan ? "表示確認中のプラン" : "現在のプラン"}: {PLAN_LABELS[planTier]}
        </span>
        {PLAN_DESCRIPTIONS[planTier]}
      </div>
    </>
  );
}
