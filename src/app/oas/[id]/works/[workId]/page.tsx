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
    icon:  "📝",
    title: "作品情報",
    desc:  "タイトル・説明・公開ステータス・あいさつメッセージを編集します",
    color: "#374151",
    bg:    "#f9fafb",
  },
  {
    key:   "characters",
    icon:  "👤",
    title: "キャラクター",
    desc:  "メッセージ送信者となるキャラクターを管理します",
    color: "#7c3aed",
    bg:    "#f5f3ff",
  },
  {
    key:   "messages",
    icon:  "💬",
    title: "メッセージ・謎",
    desc:  "フェーズごとに送信するメッセージ・謎チャレンジを管理します",
    color: "#06C755",
    bg:    "#E6F7ED",
  },
  {
    key:   "scenario",
    icon:  "🗺",
    title: "シナリオフロー",
    desc:  "フェーズの追加・並び替え・編集と遷移フローを1画面で管理します",
    color: "#059669",
    bg:    "#ecfdf5",
  },
  {
    key:   "audience",
    icon:  "🎯",
    title: "オーディエンス",
    desc:  "プレイ統計・リアルタイム・フロー・セグメント・トラッキングを確認します",
    color: "#0891b2",
    bg:    "#ecfeff",
  },
] as const;

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

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            ...(work ? [{ label: work.title }] : []),
          ]} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ margin: 0 }}>{work?.title ?? "作品"}</h2>
            {statusMeta && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "3px 10px", borderRadius: "var(--radius-full)",
                fontSize: 11, fontWeight: 700,
                background: statusMeta.bg, color: statusMeta.color,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusMeta.dot, display: "inline-block" }} />
                {statusMeta.label}
              </span>
            )}
          </div>
          {work?.description && (
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
              {work.description}
            </p>
          )}
        </div>
        <Link
          href={`/playground?work_id=${workId}&oa_id=${oaId}`}
          className="btn btn-ghost"
          onClick={() => {
            try { localStorage.setItem(`preview-confirmed-${workId}`, "1"); } catch {}
            // オンボーディング: previewed ステップを記録（fire-and-forget）
            onboardingApi.trackStep(getDevToken(), { work_id: workId, oa_id: oaId, step: "previewed" }).catch(() => {});
            // 作品数上限があるプランにはプレビュー後アップグレード誘導を表示
            if (maxWorks !== null && maxWorks !== -1) setShowUpgradeCard(true);
          }}
        >
          ▶ プレビュー
        </Link>
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
        { icon: "✅", title: "この画面でできること", points: [
          "シナリオを構成するキャラクター・フェーズ・メッセージをまとめて管理できます",
          "公開ステータスの変更や、プレビュー機能への起点になります",
        ]},
        { icon: "👆", title: "まず最初に決めること", points: [
          "① キャラクターを作成（送信者の名前・アイコン）",
          "② フェーズを作成（開始・通常・エンディング）",
          "③ メッセージを追加してフェーズに紐づける",
          "④ シナリオフローで遷移（分岐）を設定する",
        ]},
        { icon: "⚠️", title: "注意点", points: [
          "公開ステータスが「公開中」のときだけ LINE からのメッセージに反応します",
          "公開前に必ずプレビュー機能でシナリオの動作を確認してください",
        ]},
      ]} />

      {/* ── カウント表示 ── */}
      {work && (
        <div style={{
          display: "flex", gap: sp ? 12 : 10, marginBottom: 24, flexWrap: "wrap",
          padding: sp ? "12px 14px" : "14px 18px",
          background: "var(--surface)",
          border: "1px solid var(--border-light)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-xs)",
        }}>
          {[
            { label: "プレイヤー",   value: (work._count.userProgress ?? 0).toLocaleString(), icon: "👥", highlight: (work._count.userProgress ?? 0) > 0 },
            { label: "キャラクター", value: work._count.characters, icon: "🎭", highlight: false },
            { label: "フェーズ",     value: phaseCount,             icon: "🗂",  highlight: false },
            { label: "メッセージ",   value: work._count.messages,   icon: "💬", highlight: false },
          ].map(({ label, value, icon, highlight }, i, arr) => (
            <div key={label} style={{
              display: "flex", alignItems: "center", gap: 8,
              paddingRight: sp ? 0 : 18,
              borderRight: (!sp && i < arr.length - 1) ? "1px solid var(--border-light)" : "none",
            }}>
              <span style={{ fontSize: 16 }}>{icon}</span>
              <span style={{ fontSize: sp ? 18 : 20, fontWeight: 800, color: highlight ? "var(--color-info)" : "var(--text-primary)", lineHeight: 1 }}>{value}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── ハブカード ── */}
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
                background: "var(--surface)",
                border: "1px solid var(--border-light)",
                borderRadius: "var(--radius-md)",
                padding: "18px 20px",
                cursor: "pointer",
                transition: "box-shadow 0.15s, border-color 0.15s, transform 0.1s",
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                boxShadow: "var(--shadow-xs)",
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
              <div style={{
                width: 44, height: 44, borderRadius: "var(--radius-sm)", flexShrink: 0,
                background: card.bg, display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 22,
              }}>
                {card.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: card.color, marginBottom: 4 }}>
                  {card.title}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
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
