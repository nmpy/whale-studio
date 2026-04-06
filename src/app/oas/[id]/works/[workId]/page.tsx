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

// ── ステータス表示 ───────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  draft:  { label: "下書き", color: "#6b7280", bg: "#f3f4f6", dot: "#9ca3af" },
  active: { label: "公開中", color: "#166534", bg: "#dcfce7", dot: "#22c55e" },
  paused: { label: "停止中", color: "#92400e", bg: "#fef3c7", dot: "#f59e0b" },
};

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
      <div className="page-header">
        <div>
          <div className="skeleton" style={{ width: 200, height: 13, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 280, height: 22 }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <>
        <div className="page-header">
          <h2>作品</h2>
          <Link href={`/oas/${oaId}/works`} className="btn btn-ghost">← 作品リストに戻る</Link>
        </div>
        <div className="alert alert-error">{error}</div>
      </>
    );
  }

  // ── オンボーディング判定 ─────────────────────────────
  const hasCharacters  = (work?._count.characters ?? 0) > 0;
  const hasPhases      = phaseCount > 0;
  const hasMessages    = (work?._count.messages   ?? 0) > 0;
  const hasTransitions = transCount > 0;
  const isSetupIncomplete = !hasCharacters || !hasPhases || !hasMessages || !hasTransitions;


  const statusMeta = STATUS_META[work?.publish_status ?? "draft"];
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
      <div className="page-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト",       href: `/oas/${oaId}/works` },
            ...(work ? [{ label: work.title }] : []),
          ]} />

          {/* タイトル行 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
            <h2 style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: sp ? 200 : 400 }}>
              {work?.title ?? "作品"}
            </h2>
            {/* ステータスバッジ */}
            {statusMeta && (
              <span style={{
                display:      "inline-flex",
                alignItems:   "center",
                gap:          5,
                padding:      "3px 10px",
                borderRadius: "var(--radius-full)",
                fontSize:     11,
                fontWeight:   700,
                background:   statusMeta.bg,
                color:        statusMeta.color,
                flexShrink:   0,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusMeta.dot, display: "inline-block" }} />
                {statusMeta.label}
              </span>
            )}
          </div>

          {/* サブ情報行: 開始トリガー / 最終更新 */}
          <div style={{
            display:    "flex",
            alignItems: "center",
            flexWrap:   "wrap",
            gap:        "6px 16px",
            marginTop:  8,
          }}>
            {/* 開始トリガー */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                fontSize:      10,
                fontWeight:    700,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                color:         "var(--text-muted)",
                userSelect:    "none",
                flexShrink:    0,
              }}>
                開始トリガー
              </span>
              {work?.start_trigger ? (
                <span style={{
                  fontSize:     12,
                  fontWeight:   500,
                  color:        "var(--text-primary)",
                  fontFamily:   "var(--font-mono, monospace)",
                  background:   "#f8fafc",
                  border:       "1px solid var(--border-light)",
                  padding:      "1px 10px",
                  borderRadius: "var(--radius-full)",
                  maxWidth:     sp ? 140 : 260,
                  overflow:     "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace:   "nowrap",
                }}>
                  {work.start_trigger}
                </span>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#fbbf24" }} aria-hidden="true" />
                  未設定
                </span>
              )}
            </div>

            {/* 最終更新日 */}
            {work?.updated_at && (
              <time dateTime={work.updated_at} style={{ fontSize: 11, color: "var(--text-muted)" }}>
                更新 {formatDate(work.updated_at)}
              </time>
            )}
          </div>

          {/* 説明文 */}
          {work?.description && (
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 6, lineHeight: 1.6 }}>
              {work.description}
            </p>
          )}
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
        <div style={{
          marginBottom: 24,
          background:   "var(--surface)",
          border:       "1px solid var(--border-light)",
          borderRadius: "var(--radius-md)",
          boxShadow:    "var(--shadow-xs)",
          overflow:     "hidden",
        }}>
          {/* 上段: 構成要素カウント */}
          <div style={{
            display:  "flex",
            flexWrap: "wrap",
            gap:      sp ? 12 : 10,
            padding:  sp ? "12px 14px" : "14px 18px",
          }}>
            {[
              { label: "プレイヤー",   value: (work._count.userProgress ?? 0).toLocaleString(), highlight: (work._count.userProgress ?? 0) > 0 },
              { label: "キャラクター", value: work._count.characters, highlight: false },
              { label: "フェーズ",     value: phaseCount,             highlight: false },
              { label: "メッセージ",   value: work._count.messages,   highlight: false },
            ].map(({ label, value, highlight }, i, arr) => (
              <div key={label} style={{
                display: "flex", alignItems: "center", gap: 8,
                paddingRight: sp ? 0 : 18,
                borderRight: (!sp && i < arr.length - 1) ? "1px solid var(--border-light)" : "none",
              }}>
                <span style={{ fontSize: sp ? 18 : 20, fontWeight: 800, color: highlight ? "var(--color-info)" : "var(--text-primary)", lineHeight: 1 }}>{value}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
              </div>
            ))}
          </div>

          {/* 下段: 進行サマリー — プレイヤーが1人以上いる場合のみ表示 */}
          {(work._count.userProgress ?? 0) > 0 && (() => {
            const completed  = work.progress_stats?.completed   ?? 0;
            const inProgress = work.progress_stats?.in_progress ?? 0;
            const needsCheck = inProgress > 0 && completed === 0;
            return (
              <div style={{
                display:    "flex",
                alignItems: "center",
                flexWrap:   "wrap",
                gap:        8,
                padding:    sp ? "8px 14px 12px" : "8px 18px 12px",
                borderTop:  "1px solid var(--border-light)",
              }}>
                {/* 完了チップ — グリーン（WorkCard と同トーン） */}
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 12, color: completed > 0 ? "#15803d" : "var(--text-muted)",
                  background: completed > 0 ? "#f0fdf4" : "var(--gray-50)",
                  border: `1px solid ${completed > 0 ? "#86efac" : "var(--border-light)"}`,
                  padding: "3px 11px", borderRadius: "var(--radius-full)",
                }}>
                  <strong style={{ fontWeight: 700 }}>{completed.toLocaleString()}</strong>
                  <span style={{ color: completed > 0 ? "#16a34a" : "var(--text-muted)" }}>完了</span>
                </span>

                {/* 進行中チップ — グレー（WorkCard と同トーン） */}
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 12, color: "#374151",
                  background: "#f3f4f6", border: "1px solid #d1d5db",
                  padding: "3px 11px", borderRadius: "var(--radius-full)",
                }}>
                  <span style={{
                    display: "inline-block", width: 6, height: 6,
                    borderRadius: "50%", background: "#9ca3af", flexShrink: 0,
                  }} aria-hidden="true" />
                  <strong style={{ fontWeight: 700 }}>{inProgress.toLocaleString()}</strong>
                  <span style={{ color: "#6b7280" }}>進行中</span>
                </span>

                {/* 「要確認」補助ラベル — WorkCard と同条件・同トーン */}
                {needsCheck && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    fontSize: 11, color: "#b45309",
                    background: "#fffbeb", border: "1px solid #fde68a",
                    padding: "2px 9px", borderRadius: "var(--radius-full)",
                  }}>
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
        {resolvedActions.map((action) => {
          const href   = action.isPreview
            ? `/playground?work_id=${workId}&oa_id=${oaId}`
            : `${basePath}/${action.key}`;
          const es = ACTION_EMPHASIS_STYLE[action.emphasis];
          return (
            <Link
              key={action.key}
              href={href}
              onClick={action.isPreview ? handlePreviewClick : undefined}
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
        {HUB_CARDS.map((card) => (
          <Link
            key={card.key}
            href={`/oas/${oaId}/works/${workId}/${card.key}`}
            style={{ textDecoration: "none" }}
          >
            <div
              style={{
                background:   "var(--surface)",
                border:       "1px solid var(--border-light)",
                borderRadius: "var(--radius-md)",
                padding:      "16px 18px",
                cursor:       "pointer",
                transition:   "box-shadow 0.15s, border-color 0.15s, transform 0.1s",
                display:      "flex",
                alignItems:   "center",
                gap:          14,
                boxShadow:    "var(--shadow-xs)",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.boxShadow   = "var(--shadow-md)";
                el.style.borderColor = "var(--gray-300)";
                el.style.transform   = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.boxShadow   = "var(--shadow-xs)";
                el.style.borderColor = "var(--border-light)";
                el.style.transform   = "";
              }}
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
              </div>
              <span style={{ color: "var(--text-muted)", fontSize: 16, alignSelf: "center", flexShrink: 0 }}>›</span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
