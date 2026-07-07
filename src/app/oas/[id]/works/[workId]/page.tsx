"use client";

// src/app/oas/[id]/works/[workId]/page.tsx
// 作品ハブ — 各管理機能へのナビゲーション

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { workApi, oaApi, phaseApi, transitionApi, analyticsApi, liffConfigApi, locationApi, getDevToken } from "@/lib/api-client";
import type { WorkListItem } from "@/lib/api-client";
import type { AnalyticsData } from "@/types";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useEffectivePlanInfo } from "@/hooks/useEffectivePlanInfo";
import { useIsMobile } from "@/hooks/useIsMobile";
import { trackEvent } from "@/lib/event-tracker";
import { ViewerBanner } from "@/components/PermissionGuard";
import { WorkCreatedGuide }   from "@/components/onboarding/WorkCreatedGuide";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";
import { WorkLimitCard } from "@/components/upgrade/WorkLimitCard";
import { PLAN_LABELS } from "@/lib/constants/plans";
import { useAccessPreview } from "@/hooks/useAccessPreview";
import { withPreviewParams } from "@/lib/access-preview";
import { StatusBadge } from "@/components/shared";
import { isSpreadsheetImportEnabled } from "@/lib/spreadsheet-import/ui-text";
import { computeWorkTopAlerts, hasStartEntry, type WorkTopAlertTone } from "@/lib/work-top-alerts";
import { computeSetupProgress } from "@/lib/onboarding-setup";
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

// アラートのトーン別スタイル（赤一色にせず優先度を分ける）。
// info は「確認メモ / 設定ヒント」寄りに、薄い背景・控えめな枠線で圧を与えない。
const ALERT_TONE_STYLE: Record<WorkTopAlertTone, { card: string; dot: string; icon: string; iconColor: string }> = {
  warning: { card: "border-warn/25 bg-warn-soft",  dot: "bg-warn/70",   icon: "⚠", iconColor: "text-white" },
  info:    { card: "border-line bg-bg-tint",       dot: "bg-ink-3/50",  icon: "ℹ", iconColor: "text-white" },
  success: { card: "border-line bg-brand-soft/50", dot: "bg-brand/70",  icon: "✓", iconColor: "text-white" },
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
  const { effectivePlan: planTier } = useAccessPreview(oaId);

  const [oaTitle,          setOaTitle]          = useState("");
  const [work,             setWork]             = useState<WorkListItem | null>(null);
  const [phaseCount,       setPhaseCount]       = useState(0);
  const [transCount,       setTransCount]       = useState(0);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState<string | null>(null);
  const [showCreated,      setShowCreated]      = useState(false);
  // tester ロール向けプレビュー後アップグレードカード（dismissable）
  const [showUpgradeCard,  setShowUpgradeCard]  = useState(false);
  // プレイヤー状況（簡易オーディエンス）。audience 画面と同じ GET /api/analytics を流用（workId スコープ）。
  const [analytics,        setAnalytics]        = useState<AnalyticsData | null>(null);
  // LIFF ページ数・ロケーション数（作品単位・非ブロッキング取得。取得不可は null → 「—」表示）。
  const [liffCount,        setLiffCount]        = useState<number | null>(null);
  const [locationCount,    setLocationCount]    = useState<number | null>(null);

  // プレイヤー指標を非ブロッキングで取得（失敗しても作品トップ本体は表示する）。
  useEffect(() => {
    let alive = true;
    analyticsApi.get(getDevToken(), workId)
      .then((a) => { if (alive) setAnalytics(a); })
      .catch(() => { if (alive) setAnalytics(null); });
    // LIFF ページ数（fake を入れず、失敗時は null のまま「—」）。
    liffConfigApi.listPages(getDevToken(), workId)
      .then((r) => { if (alive) setLiffCount(r.pages?.length ?? 0); })
      .catch(() => { if (alive) setLiffCount(null); });
    // ロケーション数（作品スコープ）。
    locationApi.list(getDevToken(), workId)
      .then((rows) => { if (alive) setLocationCount(rows.length); })
      .catch(() => { if (alive) setLocationCount(null); });
    return () => { alive = false; };
  }, [workId]);

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
      <div className="mb-5 w-full max-w-[720px] rounded-lg border border-line bg-surface p-5 shadow-sm">
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
            href={withPreviewParams(`/oas/${oaId}/works`, searchParams)}
            className="inline-flex items-center justify-center rounded-md border border-line bg-surface px-4 py-1.5 text-[12px] font-bold text-ink-2 no-underline transition-colors hover:border-brand hover:bg-brand-mist hover:text-brand-ink"
          >
            ← 作品リストに戻る
          </Link>
        </div>
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] leading-[1.6] text-danger"
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
  // 開始導線の有無は runtime と同じ判定（Work.startKeyword ∨ 開始フェーズ startTrigger）。
  const hasStartTrigger = hasStartEntry({ startKeyword: work?.start_keyword ?? null, startTrigger: work?.start_trigger ?? null });
  const alerts = computeWorkTopAlerts({
    publishStatus:   currentStatus,
    hasStartTrigger,
    characters:      work?._count.characters ?? 0,
    phases:          phaseCount,
    messages:        work?._count.messages ?? 0,
    basePath,
  });
  // よく使う操作（作業開始に直結する導線。右側にカテゴリを表示。時刻等は取得できないため付けない）。
  const quickActions: { label: string; category: string; href: string }[] = [
    { label: "メッセージを追加",   category: "メッセージ",   href: `${basePath}/messages` },
    { label: "フェーズ管理を確認", category: "フェーズ",     href: `${basePath}/scenario` },
    { label: "キャラクターを編集", category: "キャラクター", href: `${basePath}/characters` },
    ...(isSpreadsheetImportEnabled() ? [{ label: "スプレッドシート取込", category: "メッセージ", href: `${basePath}/messages/import` }] : []),
  ];

  // 主要機能カード（既存導線を維持・カウントは既存データ / 取得不可は「—」）。
  const featureCards: { label: string; sub: string; href: string }[] = [
    { label: "フェーズ",       sub: `${phaseCount}フェーズ設定済み`,                       href: `${basePath}/scenario` },
    { label: "キャラクター",   sub: `${work?._count.characters ?? 0}体登録済み`,           href: `${basePath}/characters` },
    { label: "メッセージ",     sub: `${work?._count.messages ?? 0}件`,                     href: `${basePath}/messages` },
    { label: "LIFF",          sub: liffCount != null ? `${liffCount}ページ` : "—",         href: `${basePath}/liff` },
    { label: "ロケーション",   sub: locationCount != null ? `${locationCount}件` : "—",     href: `/oas/${oaId}/locations?workId=${workId}` },
    { label: "オーディエンス", sub: analytics ? `${analytics.summary.total_players}人` : "—", href: `${basePath}/audience` },
  ];

  // 設定状況（既存のオンボーディング判定を再利用。開始トリガーは判定できる場合のみ「設定済み」に含める）。
  const setupComplete = hasCharacters && hasPhases && hasMessages && hasStartTrigger;
  const setupDoneList = [
    "作品作成",
    hasCharacters && "キャラクター",
    hasPhases && "フェーズ",
    hasMessages && "メッセージ",
    hasStartTrigger && "開始トリガー",
  ].filter(Boolean).join("・");

  // 状態と注意点は「警告があるときだけ」表示（整っている旨は設定状況カードに集約）。
  const warningAlerts = alerts.filter((a) => a.tone !== "success");

  // ── オンボーディング/警告の表示制御 ─────────────────────────
  // 作品トップのオンボーディングは「作品の設定状況」カードに一本化する。
  // 作成直後に上部の大きなオンボーディングカード + 警告群を大量表示すると情報過多・圧迫感が出るため:
  //   1) 上部オンボーディングカード（WorkCreatedGuide / OnboardingProgress）は常に非表示（設定状況カードへ集約）。
  //   2) 警告群は「完全な新規空作品」では隠し、制作が進んだ／公開運用に近い段階でのみ表示する。
  //      まとめてゲートせず alert.key ごとに「初期状態として隠すか」を判定する（他要素の有無で分岐）。
  //      公開中判定・警告文言・href は computeWorkTopAlerts 側のまま。ここは表示可否のみ。
  const showLegacyTopGuidance = false;
  // 「開始トリガー未設定」は主要コンテンツ（キャラ・フェーズ・メッセージ）が揃った後に出す。
  // = 既存オンボーディング進捗 allDone（開始トリガーは含めない）を再利用。
  const coreSetupComplete = computeSetupProgress({ hasCharacters, hasPhases, hasMessages }).allDone;
  const visibleWarningAlerts = warningAlerts.filter((a) => {
    switch (a.key) {
      // 完全な空作品では非表示。他の制作要素があるのに欠けている場合のみ表示。
      case "no_characters":    return hasPhases || hasMessages;
      case "no_phases":        return hasCharacters || hasMessages;
      // キャラ＋フェーズありでメッセージ無し（公開中は warning 文言 / 非公開は info 文言＝既存判定）。
      case "no_messages":      return hasCharacters && hasPhases;
      // キャラ＋フェーズ＋メッセージが揃った後に表示。
      case "no_start_trigger": return coreSetupComplete;
      // 想定外の key は安全側（隠さない）。
      default:                 return true;
    }
  });

  // 直近7日間の新規参加者（棒グラフ用・API から。取得不可は null）。
  const daily = analytics?.daily_new_players ?? null;
  const dailyMax = daily ? Math.max(1, ...daily.map((d) => d.count)) : 1;

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
          { label: "TOP",        href: withPreviewParams("/oas", searchParams) },
          { label: "作品リスト", href: withPreviewParams(`/oas/${oaId}/works`, searchParams) },
          ...(work ? [{ label: work.title }] : []),
        ]} />

        {/* タイトル行 */}
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
          <h2 className="font-round m-0 overflow-hidden text-ellipsis text-[clamp(22px,4.5vw,30px)] font-extrabold leading-[1.15] tracking-[-0.02em] text-ink max-w-[240px] sm:max-w-[480px]">
            {work?.title ?? "作品"}
          </h2>
          {work?.publish_status && (
            <StatusBadge tone={statusTone(currentStatus)}>
              {currentStatusLabel}
            </StatusBadge>
          )}
        </div>

        {/* メタ情報: 作成 / 更新 / プラン */}
        <div className="mt-2 flex flex-wrap items-center gap-y-1.5 gap-x-3 text-[12px] text-ink-3">
          {work?.created_at && <span className="font-num">作成：{formatDate(work.created_at)}</span>}
          {work?.updated_at && <span className="font-num">更新：{formatDate(work.updated_at)}</span>}
          <span className="inline-flex items-center rounded-md bg-sky-soft px-2.5 py-0.5 text-[11px] font-semibold text-sky-ink">
            {planDisplayName ?? PLAN_LABELS[planTier]}
          </span>
        </div>

        {/* 権限バッジ（pink 系はトークン未定義のためコンポーネントスコープの inline style）*/}
        <div className="mt-2">
          <span
            className="inline-flex items-center rounded-md px-3 py-1 text-[12px] font-bold"
            style={{ background: "#fce7f0", color: "#c2477a" }}
          >
            {roleLabel}
          </span>
        </div>

        {work?.description && (
          <p className="mt-2 text-[13px] leading-[1.6] text-ink-2">{work.description}</p>
        )}
        </div>

        {/* 作品設定を開く（既存 /edit へ。preview query 保持。tester には出さない＝既存挙動）*/}
        {role !== "tester" && (
          <Link
            href={withPreviewParams(`${basePath}/edit`, searchParams)}
            className="inline-flex flex-shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-line bg-surface px-4 py-2.5 text-[13px] font-semibold text-ink-2 no-underline shadow-sm transition-colors hover:border-brand/40 hover:bg-brand-mist hover:text-brand-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            作品設定を開く
          </Link>
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
          作品トップのオンボーディングは「作品の設定状況」カードへ一本化する。
          上部の大きなオンボーディングカード（WorkCreatedGuide / OnboardingProgress）は
          作成直後の情報過多・設定状況カードとの二重表示を避けるため常に非表示にする。
          （showLegacyTopGuidance を true に戻せば従来の優先順で復帰:
             1. 作成直後バナー（?created=1）— WorkCreatedGuide
             2. 初回進捗ステッパー          — OnboardingProgress）
      ══════════════════════════════════════════════════════ */}
      {showLegacyTopGuidance && (showCreated && work ? (
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
      ))}

      {/* ── 状態と注意点 ──
          「完全な新規空作品」では出さず、alert.key ごとに他の制作要素の有無で表示可否を分ける
          （visibleWarningAlerts）。整っている旨は設定状況カードへ集約。 */}
      {work && visibleWarningAlerts.length > 0 && (
        <div className="mb-5 flex flex-col gap-2">
          {visibleWarningAlerts.map((a) => {
            const s = ALERT_TONE_STYLE[a.tone];
            return (
              <div key={a.key} className={"flex items-center gap-2.5 rounded-md border px-3 py-2 " + s.card}>
                <span aria-hidden="true" className={"inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold " + s.dot + " " + s.iconColor}>
                  {s.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-[12.5px] font-semibold text-ink">{a.title}</span>
                  <span className="ml-1.5 text-[11.5px] leading-[1.5] text-ink-3">{a.detail}</span>
                </div>
                {a.cta && (
                  <Link href={withPreviewParams(a.cta.href, searchParams)} className="flex-shrink-0 self-center whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-2 no-underline transition-colors hover:border-brand/40 hover:text-brand-ink">
                    {a.cta.label}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── ① 作品の設定状況 ── */}
      {work && (
        <section aria-labelledby="card-setup" className="mb-5 rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-5">
          <h3 id="card-setup" className="mb-3 text-[13px] font-bold text-ink-2">作品の設定状況</h3>

          {/* ステータスボックス */}
          <div className="mb-4 flex items-start gap-2.5 rounded-md bg-bg-tint px-3.5 py-3">
            <span aria-hidden="true" className={"mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-[12px] font-bold text-white " + (setupComplete ? "bg-brand" : "bg-ink-3/60")}>✓</span>
            <div className="min-w-0">
              <div className="text-[13.5px] font-bold text-ink">{setupComplete ? "主要な設定は整っています" : "設定を進めましょう"}</div>
              <p className="mt-0.5 text-[12px] leading-[1.6] text-ink-3">
                {setupComplete
                  ? `${setupDoneList}が設定済みです。`
                  : `${setupDoneList} が設定済みです。残りの項目を左メニューから設定してください。`}
              </p>
            </div>
          </div>

          {/* 数値カード（キャラ/フェーズ/メッセージ/LIFF/ロケーション。取得不可は「—」）*/}
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 sm:gap-3">
            {[
              { label: "キャラクター", value: work._count.characters.toLocaleString() },
              { label: "フェーズ",     value: phaseCount.toLocaleString() },
              { label: "メッセージ",   value: work._count.messages.toLocaleString() },
              { label: "LIFF",        value: liffCount != null ? liffCount.toLocaleString() : "—" },
              { label: "ロケーション", value: locationCount != null ? locationCount.toLocaleString() : "—" },
            ].map((c) => (
              <div key={c.label} className="rounded-md border border-line-2 bg-surface px-2 py-3 text-center">
                <div className="font-num text-[22px] font-extrabold leading-none text-ink">{c.value}</div>
                <div className="mt-1.5 text-[11px] text-ink-3">{c.label}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── ② プレイヤー状況 ── */}
      {work && (
        <section aria-labelledby="card-players" className="mb-5 rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 id="card-players" className="text-[13px] font-bold text-ink-2">プレイヤー状況</h3>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-md border border-brand/30 bg-brand-soft px-2.5 py-0.5 text-[11px] font-semibold text-brand-ink">直近7日間</span>
              <Link href={withPreviewParams(`${basePath}/audience`, searchParams)} className="whitespace-nowrap text-[11px] font-semibold text-ink-3 no-underline transition-colors hover:text-brand-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                詳細 ›
              </Link>
            </div>
          </div>

          {/* メトリクス（総プレイヤー / 今日の参加 / クリア済み / クリア率。null は「—」）*/}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
            {[
              { label: "総プレイヤー", value: analytics ? analytics.summary.total_players.toLocaleString() : "—",  tone: "text-ink" },
              { label: "今日の参加",   value: analytics ? analytics.realtime.started_today.toLocaleString() : "—", tone: "text-brand-ink" },
              { label: "クリア済み",   value: analytics ? analytics.summary.total_clears.toLocaleString() : "—",   tone: "text-ink" },
              { label: "クリア率",     value: analytics ? `${analytics.summary.clear_rate}%` : "—",                tone: "text-brand-ink" },
            ].map((m) => (
              <div key={m.label} className="rounded-md border border-line-2 bg-bg-tint px-2 py-3 text-center">
                <div className={"font-num text-[24px] font-extrabold leading-none " + m.tone}>{m.value}</div>
                <div className="mt-1.5 text-[11px] text-ink-3">{m.label}</div>
              </div>
            ))}
          </div>

          {/* 直近7日間の簡易棒グラフ（CSSのみ・API の daily_new_players から。取得不可はデータなし）*/}
          {/* 角丸は控えめ（四角ベース）: 枠 4px / bar は上端のみ 2px でカプセル状に見せない */}
          <div className="mt-4 rounded-sm border border-line-2 bg-bg-tint p-3.5">
            <div className="mb-2 text-[11px] font-semibold text-ink-3">直近7日間のプレイヤー数</div>
            {daily ? (
              <div className="flex items-end justify-between gap-1.5" role="img"
                aria-label={"直近7日間の新規プレイヤー数: " + daily.map((d) => `${d.label}曜 ${d.count}人`).join("、")}>
                {daily.map((d, i) => (
                  <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" title={`${d.date} ${d.count}人`}>
                    <div
                      className={"w-full [border-radius:2px_2px_0_0] " + (i === daily.length - 1 ? "bg-brand" : "bg-brand/30")}
                      style={{ height: Math.round(8 + (d.count / dailyMax) * 44) }}
                    />
                    <span className="text-[10px] text-ink-3">{d.label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-2 text-center text-[11.5px] text-ink-3">データがまだありません。</p>
            )}
          </div>

          {analytics && analytics.summary.total_players === 0 && (
            <p className="mt-2.5 text-[11.5px] text-ink-3">まだプレイヤーはいません。公開後、ここに参加状況が集まります。</p>
          )}
        </section>
      )}

      {/* ── ③ よく使う操作 ── */}
      <section aria-labelledby="card-quick" className="mb-5 rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h3 id="card-quick" className="mb-3 text-[13px] font-bold text-ink-2">よく使う操作</h3>
        <div className="flex flex-col divide-y divide-line/60">
          {/* 画面密度を下げるため表示は最大2件（配列定義は温存・表示時のみ制限）*/}
          {quickActions.slice(0, 2).map((a) => (
            <Link
              key={a.label}
              href={withPreviewParams(a.href, searchParams)}
              className="group flex items-center gap-2.5 py-2.5 no-underline first:pt-0 last:pb-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <span aria-hidden="true" className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand/50" />
              <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-ink transition-colors group-hover:text-brand-ink">{a.label}</span>
              <span className="flex-shrink-0 text-[11px] text-ink-3">{a.category}</span>
              <span aria-hidden="true" className="flex-shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5">›</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── ④ 主要機能（既存導線を維持・カードデザインのみ寄せる）── */}
      <section aria-labelledby="card-features" className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-5">
        <h3 id="card-features" className="mb-3 text-[13px] font-bold text-ink-2">主要機能</h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
          {featureCards.map((f) => (
            <Link
              key={f.label}
              href={withPreviewParams(f.href, searchParams)}
              className="rounded-md border border-line-2 bg-surface px-3.5 py-3 no-underline transition-all hover:-translate-y-px hover:border-brand/30 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <div className="text-[14px] font-bold text-ink">{f.label}</div>
              <div className="mt-1 text-[11.5px] text-ink-3">{f.sub}</div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
