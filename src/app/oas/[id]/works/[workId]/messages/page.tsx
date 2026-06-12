"use client";

// src/app/oas/[id]/works/[workId]/messages/page.tsx

import { Fragment, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { TLink as Link } from "@/components/TLink";
import { bootstrapApi, messageApi, workApi, getDevToken } from "@/lib/api-client";
import { getCachedBootstrap, setCachedBootstrap, invalidateBootstrap } from "@/lib/admin-bootstrap-cache";
import { logAdminPerf, resourceSummary, maskId } from "@/lib/perf-client";
import { HelpAccordion } from "@/components/HelpAccordion";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";
import { ViewerBanner } from "@/components/PermissionGuard";
import { GuideCard } from "@/components/onboarding/GuideCard";
import type { MessageWithRelations, MessageType, PhaseWithCounts, TransitionWithPhases, QuickReplyItem } from "@/types";
import type { Role } from "@/lib/types/permissions";
import { collectChainContinuationIds, chainSizeFrom, chainLengthFrom, estimatePhaseSendBatch, LINE_REPLY_MAX, getChainContinuations, hasAnyTiming, summarizeTiming } from "./_list-helpers";
import { computePhaseEntryPlan, type EntryPlanMessage } from "./_phase-entry-plan";
import type { RefMessage } from "@/lib/message-refs";

const MESSAGE_TYPE_LABEL: Record<MessageType, string> = {
  text:     "テキスト",
  image:    "画像",
  riddle:   "—",       // タイプ列で "謎" として表示するため種別列では非表示
  video:    "動画",
  carousel: "カルーセル",
  voice:    "ボイス",
  flex:     "Flex Message",
};

const MESSAGE_TYPE_ICON: Record<MessageType, string> = {
  text:     "",
  image:    "🖼",
  riddle:   "",         // 同上
  video:    "🎬",
  carousel: "🎠",
  voice:    "🎙",
  flex:     "🧱",
};

const PHASE_TYPE_LABEL: Record<string, string> = {
  start:   "開始",
  normal:  "通常",
  ending:  "エンディング",
  global:  "全フェーズ共通",
};

function CharIcon({ character }: { character: MessageWithRelations["character"]; size?: number }) {
  const size = 28;
  if (!character) {
    // キャラクター未設定 — グレーの人物アイコン
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: size, height: size, borderRadius: "50%",
        background: "#e5e7eb", fontSize: 13, color: "#9ca3af",
        flexShrink: 0, border: "1px solid #d1d5db",
      }} />
    );
  }

  if (character.icon_image_url) {
    // 画像アイコン
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={character.icon_image_url}
        alt={character.name}
        loading="lazy"
        decoding="async"
        style={{
          width: size, height: size, borderRadius: "50%",
          objectFit: "cover", flexShrink: 0,
          border: "1px solid #e5e7eb",
        }}
        onError={(e) => {
          // 画像読み込み失敗 → テキストフォールバック
          const el = e.currentTarget as HTMLImageElement;
          el.style.display = "none";
          const span = document.createElement("span");
          span.textContent = character.icon_text ?? character.name.charAt(0);
          Object.assign(span.style, {
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: `${size}px`, height: `${size}px`, borderRadius: "50%",
            background: character.icon_color ?? "#6366f1",
            fontSize: "11px", color: "#fff", fontWeight: "700", flexShrink: "0",
          });
          el.parentNode?.insertBefore(span, el.nextSibling);
        }}
      />
    );
  }

  // テキスト／絵文字アイコン（旧形式）
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size, height: size, borderRadius: "50%",
      background: character.icon_color ?? "#6366f1",
      fontSize: 11, color: "#fff", fontWeight: 700,
      flexShrink: 0, border: "1px solid rgba(0,0,0,0.08)",
    }}>
      {character.icon_text ?? character.name.charAt(0)}
    </span>
  );
}

function CharTag({ character }: { character: MessageWithRelations["character"] }) {
  if (!character) return <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontSize: 11, color: "var(--text-secondary)",
    }}>
      <CharIcon character={character} />
      <span style={{ fontWeight: 500 }}>{character.name}</span>
    </span>
  );
}

interface PhaseGroup {
  phase: PhaseWithCounts | null;
  messages: MessageWithRelations[];
}

const PHASE_TYPE_COLOR: Record<string, { bg: string; color: string; border: string }> = {
  start:   { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  normal:  { bg: "#f0fdf4", color: "#166534", border: "#bbf7d0" },
  ending:  { bg: "#fdf4ff", color: "#7e22ce", border: "#e9d5ff" },
  global:  { bg: "#fffbeb", color: "#b45309", border: "#fcd34d" },
};

/** タイプバッジ: 謎（puzzle / riddle）か メッセージ かの二択 */
const MSG_TYPE_META = {
  riddle:  { label: "謎",       icon: "🧩", bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
  message: { label: "メッセージ", icon: "",   bg: "#f0f9ff", color: "#0369a1", border: "#bae6fd" },
} as const;

// ── ブランチフロー ────────────────────────────────────────

const BRANCH_CHIP_PALETTE = {
  blue:   { bg: "#dbeafe", color: "#1e40af", border: "#bfdbfe" },
  orange: { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
  purple: { bg: "#f5f3ff", color: "#6d28d9", border: "#ddd6fe" },
  gray:   { bg: "#f1f5f9", color: "#475569", border: "#e2e8f0" },
  dim:    { bg: "#f9fafb", color: "#9ca3af", border: "#e5e7eb" },
} as const;

function BranchChip({
  color, children, maxWidth = 200,
}: {
  color: keyof typeof BRANCH_CHIP_PALETTE;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  const p = BRANCH_CHIP_PALETTE[color];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      fontSize: 11, fontWeight: 600,
      padding: "2px 9px", borderRadius: 12,
      background: p.bg, color: p.color, border: `1px solid ${p.border}`,
      whiteSpace: "nowrap", maxWidth, overflow: "hidden", textOverflow: "ellipsis",
      flexShrink: 0,
    }}>
      {children}
    </span>
  );
}

function BranchArrow() {
  return <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0 }}>→</span>;
}

/** メッセージ本文の短いプレビュー文字列 */
function msgPreview(m: MessageWithRelations | undefined): string {
  if (!m) return "";
  if (m.body) return m.body.length > 28 ? m.body.slice(0, 28) + "…" : m.body;
  if (m.message_type === "image")    return "🖼 画像";
  if (m.message_type === "video")    return "🎬 動画";
  if (m.message_type === "voice")    return "🎙 ボイス";
  if (m.message_type === "carousel") return "🎠 カルーセル";
  if (m.message_type === "flex")     return m.alt_text ? `🧱 ${m.alt_text.length > 24 ? m.alt_text.slice(0, 24) + "…" : m.alt_text}` : "🧱 Flex Message";
  return "(メッセージ)";
}

/** 分岐フローの「結果」表示用: キャラクター名 + 本文冒頭。例: くらげさん「あっ」
 *  キャラクター未設定なら本文プレビューのみ。 */
function msgPreviewWithChar(m: MessageWithRelations | undefined): string {
  if (!m) return "";
  const body = msgPreview(m);
  const name = m.character?.name;
  return name ? `${name}「${body}」` : body;
}

const normKw = (s: string) => s.trim().toLowerCase().normalize("NFKC");

/** QR ボタン 1 件分の「入力 → 応答 → 結果」行 */
function BranchItemRow({
  qr, phaseId, allMessages, transitions, phases,
}: {
  qr:          QuickReplyItem;
  phaseId:     string | null;
  allMessages: MessageWithRelations[];
  transitions: TransitionWithPhases[];
  phases:      PhaseWithCounts[];
}) {
  const label   = qr.label || "（ラベル未設定）";
  const keyword = normKw(qr.value || qr.label);

  // ── ヒントボタン ──
  if (qr.action === "hint") {
    const hintBody = qr.hint_text
      ? (qr.hint_text.length > 28 ? qr.hint_text.slice(0, 28) + "…" : qr.hint_text)
      : "ヒント本文未設定";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        <BranchChip color="blue">{label}</BranchChip>
        <BranchArrow />
        <BranchChip color="orange">💡 {hintBody}</BranchChip>
        <BranchArrow />
        <BranchChip color="gray">入力待ち継続</BranchChip>
      </div>
    );
  }

  // ────────────────────────────────────────────────
  // Step 2: 応答メッセージの解決
  // 優先順位:
  //   1. qr.response_message_id（直接設定・新システム）
  //   2. trigger_keyword 照合（全フェーズ対象・旧システム互換）
  // ────────────────────────────────────────────────

  // 1. 直接設定（response_message_id）
  const directRespMsg: MessageWithRelations | null = qr.response_message_id
    ? (allMessages.find((m) => m.id === qr.response_message_id) ?? null)
    : null;

  // 2. キーワード照合（全フェーズ対象 — 同フェーズ限定を廃止）
  const kwResponseMessages = allMessages.filter((m) =>
    m.kind === "response" &&
    m.is_active &&
    m.trigger_keyword &&
    m.trigger_keyword.split("\n").map(normKw).some((k) => k === keyword)
  );

  // 表示に使う応答メッセージ（直接設定を優先）
  const firstResp: MessageWithRelations | null =
    directRespMsg ?? kwResponseMessages[0] ?? null;

  // 応答メッセージの総件数（+N件 表示用）
  const respCount = directRespMsg
    ? 1 + kwResponseMessages.length   // direct + keyword 両方
    : kwResponseMessages.length;

  // ────────────────────────────────────────────────
  // Step 3: 遷移先の解決
  // 優先順位:
  //   1. qr.target_phase_id（直接設定・フェーズ遷移）
  //   2. qr.target_message_id（直接設定・メッセージ遷移）
  //   3. transitions 照合（フェーズ遷移定義）
  //   4. firstResp の next_message_id（チェーン）
  // ────────────────────────────────────────────────

  // 1. 直接設定: target_phase_id
  const directTargetPhase: PhaseWithCounts | null = qr.target_phase_id
    ? (phases.find((p) => p.id === qr.target_phase_id) ?? null)
    : null;

  // 2. 直接設定: target_message_id
  const directTargetMsg: MessageWithRelations | null = qr.target_message_id
    ? (allMessages.find((m) => m.id === qr.target_message_id) ?? null)
    : null;

  // 3. 遷移定義照合（現フェーズのみ）
  const matchedTransitions = phaseId
    ? transitions.filter(
        (t) => t.from_phase_id === phaseId && t.is_active && normKw(t.label) === keyword
      )
    : [];
  const firstTrans = matchedTransitions[0] ?? null;

  // 4. チェーン（応答メッセージの next_message_id）
  const chainMsg: MessageWithRelations | null = firstResp?.next_message_id
    ? (allMessages.find((m) => m.id === firstResp!.next_message_id) ?? null)
    : null;

  const hasAnyResult =
    firstResp !== null ||
    directTargetPhase !== null ||
    directTargetMsg !== null ||
    firstTrans !== null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      {/* 1. ユーザー入力（QR） */}
      <BranchChip color="blue">{label}</BranchChip>

      {/* 2. 応答メッセージ（Step 2） */}
      {firstResp && (
        <>
          <BranchArrow />
          <BranchChip color="orange">{msgPreviewWithChar(firstResp)}</BranchChip>
          {respCount > 1 && (
            <span style={{ fontSize: 10, color: "#9ca3af" }}>+{respCount - 1}件</span>
          )}
        </>
      )}

      {/* 3. 遷移先（Step 3）— 優先順位通りに1つだけ表示 */}
      {directTargetPhase ? (
        <>
          <BranchArrow />
          <BranchChip color="purple">
            → {directTargetPhase.name}
          </BranchChip>
        </>
      ) : directTargetMsg ? (
        <>
          <BranchArrow />
          <BranchChip color="purple">
            → {msgPreviewWithChar(directTargetMsg)}
          </BranchChip>
          {chainSizeFrom(allMessages, directTargetMsg.id) > 1 && (
            <span style={{ fontSize: 10, color: "#9ca3af" }}>
              +{chainSizeFrom(allMessages, directTargetMsg.id) - 1}通の連続
            </span>
          )}
        </>
      ) : firstTrans ? (
        <>
          <BranchArrow />
          <BranchChip color="purple">→ {firstTrans.to_phase.name}</BranchChip>
        </>
      ) : chainMsg ? (
        <>
          <BranchArrow />
          <BranchChip color="gray">→ {msgPreviewWithChar(chainMsg)}</BranchChip>
        </>
      ) : firstResp ? (
        <>
          <BranchArrow />
          <BranchChip color="gray">入力待ち継続</BranchChip>
        </>
      ) : !hasAnyResult ? (
        <>
          <BranchArrow />
          <BranchChip color="dim">応答なし</BranchChip>
        </>
      ) : null}
    </div>
  );
}

/** メッセージ行の直下に挿入するブランチパネル（QR がある場合のみ描画） */
function BranchRows({
  msg, allMessages, transitions, phases, colSpan,
}: {
  msg:         MessageWithRelations;
  allMessages: MessageWithRelations[];
  transitions: TransitionWithPhases[];
  phases:      PhaseWithCounts[];
  colSpan:     number;
}) {
  const qrs = (msg.quick_replies ?? []).filter(
    (q) => q.enabled !== false
  ) as QuickReplyItem[];
  if (qrs.length === 0) return null;

  return (
    <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <div style={{
          padding: "10px 18px 12px",
          background: "#f8fafc",
          borderTop: "1px dashed #e2e8f0",
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: "#94a3b8",
            letterSpacing: 0.5, marginBottom: 8,
            display: "flex", alignItems: "center", gap: 5,
          }}>
            <span>↕</span>
            <span>分岐フロー</span>
            <span style={{
              fontSize: 9, fontWeight: 700,
              background: "#e2e8f0", color: "#64748b",
              borderRadius: 8, padding: "0 5px",
            }}>{qrs.length}件</span>
            <span style={{ fontWeight: 400, color: "#cbd5e1" }}>
              ユーザー入力 → 応答 → 結果
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {qrs.map((qr, i) => (
              <BranchItemRow
                key={i}
                qr={qr}
                phaseId={msg.phase?.id ?? null}
                allMessages={allMessages}
                transitions={transitions}
                phases={phases}
              />
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
}

type Tab = "messages" | "welcome";

export default function MessagesPage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const { showToast } = useToast();
  // role / canEdit は Bootstrap API のレスポンス（実 role）から初期化する。
  // 従来は useWorkspaceRole が /api/oas/[id]/members/me を別途 fetch していたが、
  // Bootstrap に集約して初期表示の往復を削減した（preview は UI 専用のため挙動不変）。
  const [role, setRole]                 = useState<Role | null>(null);
  const [canEdit, setCanEdit]           = useState(false);
  const [activeTab, setActiveTab]       = useState<Tab>("messages");
  const [workTitle, setWorkTitle]       = useState("");
  const [welcomeMsg, setWelcomeMsg]     = useState<string | null>(null);
  // あいさつメッセージのタブ内インライン編集。画面遷移せずこのタブで設定/編集/解除する。
  const [editingWelcome, setEditingWelcome] = useState(false);
  const [welcomeDraft,   setWelcomeDraft]   = useState("");
  const [savingWelcome,  setSavingWelcome]  = useState(false);
  // 友だち追加（follow）時の動作（作品単位）。Bootstrap の work.follow_action 由来。
  const [followAction,   setFollowAction]   = useState<"auto_start" | "welcome_wait" | "none">("auto_start");
  const [savingFollow,   setSavingFollow]   = useState(false);
  // 途中再開機能の有効/無効（作品単位デフォルト設定）。Bootstrap の work.resume_enabled 由来。
  const [resumeEnabled, setResumeEnabled] = useState(true);
  const [savingResume, setSavingResume]   = useState(false);
  const [messages, setMessages]         = useState<MessageWithRelations[]>([]);
  const [phases, setPhases]             = useState<PhaseWithCounts[]>([]);
  const [transitions, setTransitions]   = useState<TransitionWithPhases[]>([]);
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState<string | null>(null);
  // chain head ID の Set。展開状態の head はここに含まれる (= 連続メッセージ展開トグル用)
  const [expandedChains, setExpandedChains] = useState<Set<string>>(new Set());
  // 操作中の messageId (= 削除/並び替え 進行中の表示用)
  const [busyMessageId, setBusyMessageId] = useState<string | null>(null);
  const toggleChainExpansion = (headId: string) => {
    setExpandedChains((prev) => {
      const next = new Set(prev);
      if (next.has(headId)) next.delete(headId);
      else next.add(headId);
      return next;
    });
  };

  /** 一覧からメッセージを削除する (chain head 専用)。
   *  確認ダイアログを出し、API 呼び出し成功で local state からも除去する。 */
  async function handleDeleteMessage(headMsg: MessageWithRelations) {
    if (busyMessageId) return;
    const ok = window.confirm(
      `メッセージを削除しますか？\nこの操作は取り消せません。関連する応答キーワードや設定も削除されます。`,
    );
    if (!ok) return;
    setBusyMessageId(headMsg.id);
    try {
      await messageApi.delete(getDevToken(), headMsg.id);
      invalidateBootstrap(oaId, workId); // 次回再訪で最新を取得（stale 表示防止）
      // local state からも該当メッセージ + chain continuation を除去
      const contIds = new Set(getChainContinuations(messages, headMsg.id).map((c) => c.id));
      setMessages((prev) => prev.filter((m) => m.id !== headMsg.id && !contIds.has(m.id)));
      // 展開状態も clear
      setExpandedChains((prev) => {
        if (!prev.has(headMsg.id)) return prev;
        const next = new Set(prev);
        next.delete(headMsg.id);
        return next;
      });
      showToast("メッセージを削除しました", "success");
    } catch (err) {
      console.error("[messages] delete error:", err);
      showToast(err instanceof Error ? err.message : "メッセージの削除に失敗しました", "error");
    } finally {
      setBusyMessageId(null);
    }
  }

  /** phase グループ内で head メッセージを 1 件分上下に並び替える。
   *  - direction="up": 一つ前と sortOrder を入れ替える (= 0 番目なら no-op)
   *  - direction="down": 一つ後と sortOrder を入れ替える (= 最後なら no-op)
   *  バックエンドには「グループ全体の新しい順序」を渡し、sortOrder を 0,1,2,... で再付番する。
   *  これにより既存メッセージ間で sortOrder の重複が起きていても整理される副次効果あり。 */
  async function handleReorderMessage(
    headMsg: MessageWithRelations,
    direction: "up" | "down",
    groupHeads: MessageWithRelations[],
  ) {
    if (busyMessageId) return;
    const idx = groupHeads.findIndex((m) => m.id === headMsg.id);
    if (idx === -1) return;
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === groupHeads.length - 1) return;

    const newOrder = [...groupHeads];
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    [newOrder[idx], newOrder[swapWith]] = [newOrder[swapWith], newOrder[idx]];

    setBusyMessageId(headMsg.id);
    try {
      await messageApi.reorder(getDevToken(), {
        work_id:     workId,
        message_ids: newOrder.map((m) => m.id),
      });
      invalidateBootstrap(oaId, workId); // 次回再訪で最新を取得（stale 表示防止）
      // local state を新しい順序で更新 (= sortOrder を 0,1,2,... で再付番)
      const newSortByMsgId = new Map(newOrder.map((m, i) => [m.id, i]));
      setMessages((prev) =>
        prev.map((m) =>
          newSortByMsgId.has(m.id) ? { ...m, sort_order: newSortByMsgId.get(m.id)! } : m,
        ),
      );
    } catch (err) {
      console.error("[messages] reorder error:", err);
      showToast(err instanceof Error ? err.message : "並び替えに失敗しました", "error");
    } finally {
      setBusyMessageId(null);
    }
  }

  /** 一覧から is_active をトグルする。
   *  楽観的更新で即時反映し、失敗時は元に戻して toast を表示する。
   *  is_active のみを送信するため他フィールドへの副作用なし。 */
  async function handleToggleActive(msg: MessageWithRelations) {
    if (busyMessageId) return;
    const nextActive = !msg.is_active;
    setBusyMessageId(msg.id);
    // 楽観的更新
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, is_active: nextActive } : m)));
    try {
      await messageApi.update(getDevToken(), msg.id, { is_active: nextActive });
      invalidateBootstrap(oaId, workId); // 次回再訪で最新を取得（stale 表示防止）
      showToast(nextActive ? "メッセージを有効化しました" : "メッセージを無効化しました", "success");
    } catch (err) {
      console.error("[messages] toggle is_active error:", err);
      // ロールバック
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, is_active: msg.is_active } : m)));
      showToast(err instanceof Error ? err.message : "状態の切り替えに失敗しました", "error");
    } finally {
      setBusyMessageId(null);
    }
  }

  /** 途中再開（作品単位デフォルト設定）をトグルする。
   *  楽観的更新で即時反映し、PATCH /api/works/[workId] に resume_enabled を保存。
   *  失敗時は元に戻して toast を表示する。 */
  async function handleToggleResume(next: boolean) {
    if (savingResume) return;
    const prev = resumeEnabled;
    setResumeEnabled(next); // 楽観的更新
    setSavingResume(true);
    try {
      await workApi.update(getDevToken(), workId, { resume_enabled: next });
      invalidateBootstrap(oaId, workId); // 次回再訪で最新を取得（stale 表示防止）
      showToast(next ? "途中再開を有効にしました" : "途中再開を無効にしました", "success");
    } catch (err) {
      console.error("[messages] toggle resume_enabled error:", err);
      setResumeEnabled(prev); // ロールバック
      showToast(err instanceof Error ? err.message : "設定の保存に失敗しました", "error");
    } finally {
      setSavingResume(false);
    }
  }

  // ── あいさつメッセージ（Work.welcomeMessage）のタブ内インライン編集 ──
  // 画面遷移せず、このタブで作成・編集・解除まで完結する。保存は PATCH /api/works/[workId]。
  function startEditWelcome() {
    setWelcomeDraft(welcomeMsg ?? "");
    setEditingWelcome(true);
  }
  function cancelEditWelcome() {
    setEditingWelcome(false);
    setWelcomeDraft("");
  }
  async function saveWelcome() {
    const text = welcomeDraft.trim();
    if (!text || savingWelcome) return; // 空のときは保存しない（解除は専用ボタン）
    setSavingWelcome(true);
    try {
      const updated = await workApi.update(getDevToken(), workId, { welcome_message: text });
      setWelcomeMsg(updated.welcome_message ?? text);
      invalidateBootstrap(oaId, workId); // 次回再訪で最新取得（stale 防止）
      setEditingWelcome(false);
      showToast("あいさつメッセージを保存しました", "success");
    } catch (err) {
      // 画面遷移せず toast でエラー表示
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSavingWelcome(false);
    }
  }
  async function clearWelcome() {
    if (savingWelcome) return;
    if (!confirm("あいさつメッセージを未設定に戻しますか？\n（本文の紐付けを解除します。未設定時はシステムの既定文が使われます）")) return;
    setSavingWelcome(true);
    try {
      await workApi.update(getDevToken(), workId, { welcome_message: null });
      setWelcomeMsg(null);
      invalidateBootstrap(oaId, workId);
      setEditingWelcome(false);
      showToast("あいさつメッセージを未設定に戻しました", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "解除に失敗しました", "error");
    } finally {
      setSavingWelcome(false);
    }
  }

  // 友だち追加時の動作を変更する（PATCH /api/works/[workId] follow_action）。楽観的更新。
  async function changeFollowAction(next: "auto_start" | "welcome_wait" | "none") {
    if (savingFollow || next === followAction) return;
    const prev = followAction;
    setFollowAction(next); // 楽観的更新
    setSavingFollow(true);
    try {
      await workApi.update(getDevToken(), workId, { follow_action: next });
      invalidateBootstrap(oaId, workId);
      showToast("友だち追加時の動作を変更しました", "success");
    } catch (err) {
      setFollowAction(prev); // ロールバック
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSavingFollow(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());

    // Bootstrap レスポンスを各 state に反映する共通処理。
    function applyData(data: import("@/lib/api-client").MessagesBootstrapData) {
      setWorkTitle(data.work.title);
      setWelcomeMsg(data.work.welcome_message ?? "");
      setFollowAction((data.work.follow_action as "auto_start" | "welcome_wait" | "none" | undefined) ?? "auto_start");
      setResumeEnabled(data.work.resume_enabled !== false);
      setMessages(data.messages);
      setPhases([...data.phases].sort((a, b) => a.sort_order - b.sort_order));
      setTransitions(data.transitions);
      setRole(data.role);
      setCanEdit(data.permissions.can_edit);
    }

    const ROUTE = "/oas/[id]/works/[workId]/messages";
    logAdminPerf(ROUTE, { pageStart: 0, oa: maskId(oaId), work: maskId(workId) });

    // 1) cache hit があれば即時表示（真っ白待ちをなくす / 再訪を即時化）。
    const cached = getCachedBootstrap(oaId, workId);
    const cacheState = cached ? (cached.isFresh ? "hit" : "stale") : "miss";
    if (cached) {
      applyData(cached.data);
      setLoading(false);
      setLoadError(null);
      logAdminPerf(ROUTE, { firstListPaint: Math.round(performance.now() - t0), cache: cacheState });
    } else {
      setLoading(true);
      setLoadError(null);
    }

    // 2) cache の有無に関わらず、必ず Bootstrap を 1 本取得して revalidate する
    //    (= stale-while-revalidate)。
    //    こうすることで、メッセージ作成/編集や phase/transition/シナリオ編集など
    //    **他ページでの更新**後にこの一覧へ戻ったとき、各更新ページに invalidate を
    //    仕込まなくても次 mount で必ず最新へ自己修復される（cache hit 時は即描画 →
    //    裏で最新に差し替え）。一覧自身の楽観更新 (delete/reorder/toggle) は即時整合の
    //    ため invalidateBootstrap でも消している。
    const fetchStart = (typeof performance !== "undefined" ? performance.now() : 0);
    bootstrapApi.messages(getDevToken(), oaId, workId)
      .then((data) => {
        if (cancelled) return;
        applyData(data);
        setCachedBootstrap(oaId, workId, data);
        setLoadError(null);
        const res = resourceSummary();
        logAdminPerf(ROUTE, {
          bootstrapFetch: Math.round(performance.now() - fetchStart),
          cache:          cacheState,
          firstData:      Math.round(performance.now() - t0),
          // 初期表示で Bootstrap 1 本に集約済み（旧 5 API は走らない）。
          apiCount:       1,
          msgs:           data.counts.messages,
          phases:         data.counts.phases,
          trans:          data.counts.transitions,
          resourceCount:  res.count,
          transferredKB:  res.transferredKB,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        // cache 表示済みなら、裏 revalidate の失敗で画面を壊さない（既存表示を維持）。
        if (!cached) setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [oaId, workId]);

  // ────────────────────────────────────────────────
  // chain continuation メッセージ (= 他メッセージの next_message_id から指されているもの)
  // を一覧から除外するための ID Set。
  //
  // 背景: 編集画面で chain を組んだ場合、2 通目以降は親と同じ phase_id を持つ
  //   トップレベル行として DB に作成される (= messageApi.create 経由)。
  //   一覧側で chain continuation を除外しないと、ユーザー体験的には「1 つの塊」のはずが
  //   「複数の独立メッセージ」に見えてしまう。
  //
  // 純関数 helper は _list-helpers.ts に切り出し (= テスト容易性のため)。
  // runtime / webhook には一切触らない (Phase 2a スコープ)。
  // ────────────────────────────────────────────────
  const chainContinuationIds = collectChainContinuationIds(messages);
  // 一覧の件数 (タブ / フッター) はチェーン継続を除いた「先頭メッセージ」基準で数える。
  // phase 見出しの 件数 は buildPhaseGroups 内で既に filter 済みなので別途集計不要。
  const headMessageCount = messages.length - chainContinuationIds.size;

  // フェーズごとにメッセージをグルーピング (= chain head のみを対象にする)
  function buildPhaseGroups(): PhaseGroup[] {
    const phaseIds = new Set(phases.map((p) => p.id));
    // chain continuation を除外した「先頭メッセージ」のみ
    const heads = messages.filter((m) => !chainContinuationIds.has(m.id));

    // sort_order が同値の場合は created_at で tie-break して order を安定させる。
    // 特に chain 継続メッセージは親と同じ sort_order を持つため、何らかの理由で chain link が
    // 切れて head として扱われた場合に表示順が不定になるのを防ぐ。
    const byOrderAndCreated = (a: MessageWithRelations, b: MessageWithRelations) => {
      const so = a.sort_order - b.sort_order;
      if (so !== 0) return so;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    };

    const groups: PhaseGroup[] = phases
      .map((ph) => ({
        phase: ph,
        messages: heads
          .filter((m) => m.phase?.id === ph.id)
          .sort(byOrderAndCreated),
      }))
      .filter((g) => g.messages.length > 0);

    const unassigned = heads
      .filter((m) => !m.phase || !phaseIds.has(m.phase.id))
      .sort(byOrderAndCreated);

    if (unassigned.length > 0) {
      groups.push({ phase: null, messages: unassigned });
    }
    return groups;
  }

  const breadcrumb = (
    <Breadcrumb items={[
      { label: "アカウントリスト", href: "/oas" },
      { label: "作品リスト", href: `/oas/${oaId}/works` },
      ...(workTitle ? [{ label: workTitle, href: `/oas/${oaId}/works/${workId}` }] : []),
      { label: "メッセージ" },
    ]} />
  );

  if (loading) {
    return (
      <>
        <div className="page-header">
          <div>{breadcrumb}<h2>メッセージ</h2></div>
        </div>
        <div className="card" style={{ padding: 0 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ padding: "14px 20px", borderBottom: "1px solid #e5e5e5", display: "flex", gap: 16 }}>
              <div className="skeleton" style={{ width: 60,  height: 14 }} />
              <div className="skeleton" style={{ width: 80,  height: 14 }} />
              <div className="skeleton" style={{ flex: 1,   height: 14 }} />
              <div className="skeleton" style={{ width: 60,  height: 14 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="page-header">
          <div>{breadcrumb}<h2>メッセージ</h2></div>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  const phaseGroups = buildPhaseGroups();

  // ── タブ共通スタイル (work detail 配下の他タブと揃える) ──
  const tabStyle = (tab: Tab): React.CSSProperties => ({
    padding: "8px 18px",
    fontSize: 13,
    fontWeight: 600,
    color: activeTab === tab ? "#06C755" : "#6b7280",
    background: "none",
    border: "none",
    borderBottom: activeTab === tab ? "2px solid #06C755" : "2px solid transparent",
    cursor: "pointer",
    transition: "color 0.15s, border-color 0.15s",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap" as const,
  });

  return (
    <>
      <ViewerBanner role={role} />
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          {breadcrumb}
          <h2>{activeTab === "welcome" ? "あいさつメッセージ" : "メッセージ"}</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            {activeTab === "welcome"
              ? "友だち追加・シナリオ開始前に送る特別なメッセージです"
              : "フェーズごとに送信するメッセージを管理します"}
          </p>
        </div>
        {activeTab === "messages" && canEdit && (
          <Link href={`/oas/${oaId}/works/${workId}/messages/new`} className="btn btn-primary">
            ＋ メッセージを追加
          </Link>
        )}
        {/* あいさつメッセージはタブ内（カード内）で設定・編集・解除する（画面遷移しない）。
            ヘッダーのアカウント情報画面への遷移ボタンは廃止。 */}
      </div>

      {/* ── タブバー ── */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid var(--border-light)",
        marginBottom: 20,
        gap: 0,
      }}>
        <button type="button" style={tabStyle("messages")} onClick={() => setActiveTab("messages")}>
          メッセージ
          <span style={{
            fontSize: 10, fontWeight: 700,
            background: activeTab === "messages" ? "#dcfce7" : "#f3f4f6",
            color: activeTab === "messages" ? "#166534" : "#9ca3af",
            borderRadius: 8, padding: "0 5px",
          }}>
            {headMessageCount}
          </span>
        </button>
        <button type="button" style={tabStyle("welcome")} onClick={() => setActiveTab("welcome")}>
          👋 あいさつメッセージ
          {welcomeMsg?.trim() ? (
            <span style={{
              fontSize: 10, fontWeight: 700,
              background: activeTab === "welcome" ? "#dcfce7" : "#f3f4f6",
              color: activeTab === "welcome" ? "#166534" : "#9ca3af",
              borderRadius: 8, padding: "0 5px",
            }}>設定済み</span>
          ) : (
            <span style={{
              fontSize: 10, fontWeight: 700,
              background: "#fef2f2", color: "#dc2626",
              borderRadius: 8, padding: "0 5px",
            }}>未設定</span>
          )}
        </button>
      </div>

      {/* ══════════════════════════════════════════════
          タブ: あいさつメッセージ
      ══════════════════════════════════════════════ */}
      {activeTab === "welcome" && (
        <div style={{ maxWidth: 680 }}>
          {/* 役割説明バナー */}
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 14,
            background: "linear-gradient(135deg, #ecfdf5 0%, #f0f9ff 100%)",
            border: "1px solid #a7f3d0",
            borderRadius: 12, padding: "18px 20px", marginBottom: 24,
          }}>
            <span style={{ fontSize: 32, flexShrink: 0 }}>👋</span>
            <div>
              <p style={{ fontWeight: 700, fontSize: 14, color: "#065f46", margin: "0 0 6px" }}>
                あいさつメッセージとは
              </p>
              <p style={{ fontSize: 13, color: "#047857", margin: 0, lineHeight: 1.7 }}>
                友だち追加直後・シナリオ未開始のユーザーが最初に受け取る特別なメッセージです。
                通常のシナリオメッセージとは別に管理されており、<strong>「はじめる」と送る前</strong>に自動で届きます。
              </p>
              <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
                {[
                  { text: "友だち追加時に自動送信" },
                  { text: "シナリオ開始前の一度きり" },
                  { text: "このタブで作成・編集可能" },
                ].map(({ text }) => (
                  <span key={text} style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 11, color: "#059669", fontWeight: 600,
                  }}>
                    {text}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 友だち追加時の動作（作品単位）。welcome_wait のときだけ下のあいさつ設定が有効。 */}
          <div className="card" style={{ padding: "20px 24px", marginBottom: 24 }}>
            <p style={{ fontWeight: 700, fontSize: 14, color: "#111827", margin: "0 0 4px" }}>
              友だち追加時の動作
            </p>
            <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 14px", lineHeight: 1.7 }}>
              友だち追加（フォロー）された直後の挙動を作品単位で選べます。
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {([
                { value: "welcome_wait", label: "あいさつメッセージを送って「はじめる」を待つ" },
                { value: "auto_start",   label: "すぐにシナリオを開始する" },
                { value: "none",         label: "何もしない" },
              ] as const).map(({ value, label }) => (
                <label key={value} style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  fontSize: 13, color: "#374151", cursor: canEdit ? "pointer" : "default",
                }}>
                  <input
                    type="radio"
                    name="follow_action"
                    value={value}
                    checked={followAction === value}
                    disabled={!canEdit || savingFollow}
                    onChange={() => changeFollowAction(value)}
                    style={{ marginTop: 2 }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            {followAction === "auto_start" && (
              <p style={{ fontSize: 12, color: "#92400e", margin: "12px 0 0", lineHeight: 1.7 }}>
                この設定では友だち追加直後に本編が始まるため、あいさつメッセージは送信されません。
              </p>
            )}
            {followAction === "none" && (
              <p style={{ fontSize: 12, color: "#6b7280", margin: "12px 0 0", lineHeight: 1.7 }}>
                友だち追加時には何も送信されません。
              </p>
            )}
          </div>

          {/* 現在の設定（あいさつメッセージ）。「はじめる」を待つモードのときのみ表示・編集可能。 */}
          {followAction === "welcome_wait" ? (
          <div className="card" style={{ padding: "20px 24px" }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 16,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>
                  現在のあいさつメッセージ
                </span>
                {welcomeMsg?.trim() ? (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: "#166534",
                    background: "#dcfce7", padding: "1px 8px", borderRadius: 10,
                    border: "1px solid #bbf7d0",
                  }}>設定済み</span>
                ) : (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: "#dc2626",
                    background: "#fef2f2", padding: "1px 8px", borderRadius: 10,
                    border: "1px solid #fecaca",
                  }}>未設定</span>
                )}
              </div>
            </div>

            {/* OA Manager 側との二重送信に関する注意書き */}
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8,
              padding: "10px 14px", marginBottom: 16,
              fontSize: 12, color: "#92400e", lineHeight: 1.7,
            }}>
              <span aria-hidden="true">⚠️</span>
              <span>
                LINE Official Account Manager 側のあいさつメッセージが ON の場合、メッセージが二重で
                送信される可能性があります。Whale Studio 側で管理する場合は、OA Manager 側の
                あいさつメッセージを OFF にしてください。
              </span>
            </div>

            {editingWelcome ? (
              /* ── 編集モード（タブ内・画面遷移なし） ── */
              <>
                <textarea
                  value={welcomeDraft}
                  onChange={(e) => setWelcomeDraft(e.target.value)}
                  maxLength={2000}
                  rows={5}
                  placeholder="例：はじめまして！この物語体験へようこそ。「はじめる」と送ると物語がスタートします。"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "12px 14px", fontSize: 14, lineHeight: 1.7,
                    border: "1.5px solid #e5e7eb", borderRadius: 10,
                    resize: "vertical", color: "#111827",
                  }}
                />
                <p style={{ fontSize: 11, color: "#9ca3af", margin: "6px 0 0" }}>
                  {welcomeDraft.length} / 2000
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
                  <button type="button" className="btn btn-ghost" onClick={cancelEditWelcome} disabled={savingWelcome}>
                    キャンセル
                  </button>
                  <button type="button" className="btn btn-primary" onClick={saveWelcome} disabled={savingWelcome || !welcomeDraft.trim()}>
                    {savingWelcome ? "保存中..." : "保存する"}
                  </button>
                </div>
              </>
            ) : welcomeMsg?.trim() ? (
              /* ── 設定済み（プレビュー + 編集 / 未設定に戻す） ── */
              <>
                <div style={{
                  background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12,
                  padding: "16px 18px", marginBottom: 16, position: "relative",
                }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: "#16a34a",
                    letterSpacing: 0.5, marginBottom: 8, textTransform: "uppercase",
                  }}>
                    PREVIEW
                  </div>
                  <p style={{
                    fontSize: 14, color: "#111827", margin: 0,
                    whiteSpace: "pre-wrap", lineHeight: 1.8, wordBreak: "break-all",
                  }}>
                    {welcomeMsg}
                  </p>
                </div>
                {canEdit && (
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button type="button" className="btn btn-ghost" onClick={clearWelcome} disabled={savingWelcome}>
                      未設定に戻す
                    </button>
                    <button type="button" className="btn btn-primary" onClick={startEditWelcome} disabled={savingWelcome}>
                      編集する
                    </button>
                  </div>
                )}
              </>
            ) : (
              /* ── 未設定（このタブで設定開始・画面遷移なし） ── */
              <div style={{
                background: "#fffbeb", border: "1px solid #fde68a",
                borderRadius: 10, padding: "24px 20px", textAlign: "center",
              }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
                <p style={{ fontWeight: 700, fontSize: 14, color: "#92400e", margin: "0 0 6px" }}>
                  あいさつメッセージが未設定です
                </p>
                <p style={{ fontSize: 12, color: "#b45309", margin: "0 0 16px", lineHeight: 1.7 }}>
                  友だち追加時に何も届かない状態です。<br />
                  ユーザーへの最初の接触なので、必ず設定することをおすすめします。
                </p>
                {canEdit && (
                  <button type="button" className="btn btn-primary" onClick={startEditWelcome}>
                    今すぐ設定する
                  </button>
                )}
              </div>
            )}
          </div>
          ) : (
            <div className="card" style={{ padding: "16px 24px" }}>
              <p style={{ fontSize: 13, color: "#6b7280", margin: 0, lineHeight: 1.8 }}>
                {followAction === "auto_start"
                  ? "現在は「すぐにシナリオを開始する」設定です。友だち追加直後に本編が始まるため、あいさつメッセージは送信されません。あいさつメッセージを使う場合は、上の「友だち追加時の動作」で「あいさつメッセージを送って『はじめる』を待つ」を選択してください。"
                  : "現在は「何もしない」設定です。友だち追加時には何も送信されません。あいさつメッセージを使う場合は、上の「友だち追加時の動作」で「あいさつメッセージを送って『はじめる』を待つ」を選択してください。"}
              </p>
            </div>
          )}

          {/* 使い方ガイド */}
          <HelpAccordion items={[
            { title: "あいさつメッセージの使い方", points: [
              "「今日からあなたの相棒になる物語体験へようこそ！」のような導入文を設定します",
              "シナリオの世界観・始め方をユーザーに伝える場として活用してください",
              "「はじめる」と送ることでシナリオが開始される旨を明記すると分かりやすいです",
            ]},
            { title: "編集場所について", points: [
              "あいさつメッセージはこのタブ内で作成・編集・解除できます（作品単位の設定です）",
              "未設定のときはシステムの既定文が使われます",
              "OA Manager 側のあいさつメッセージが ON だと二重送信になる可能性があるため、Whale Studio 側で管理する場合は OA Manager 側を OFF にしてください",
            ]},
          ]} />
        </div>
      )}

      {/* ══════════════════════════════════════════════
          タブ: メッセージ
      ══════════════════════════════════════════════ */}
      {activeTab === "messages" && (<>
      {/* ── デフォルト設定（作品単位） ── */}
      <div
        className="card"
        style={{ padding: "12px 16px", marginBottom: 16, borderTop: "3px solid #e0e7ff" }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 8 }}>
          デフォルト設定
        </div>
        <label
          style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            cursor: canEdit && !savingResume ? "pointer" : "default",
            opacity: canEdit ? 1 : 0.6,
          }}
        >
          <input
            type="checkbox"
            checked={resumeEnabled}
            disabled={!canEdit || savingResume}
            onChange={(e) => handleToggleResume(e.target.checked)}
            style={{ marginTop: 3, flexShrink: 0 }}
          />
          <span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
              途中再開を有効にする
            </span>
            {savingResume && (
              <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 8 }}>保存中…</span>
            )}
            <span style={{ display: "block", fontSize: 12, color: "#6b7280", marginTop: 2, lineHeight: 1.6 }}>
              ユーザーがフェーズの途中で開始トリガーを再送したときに、「途中から再開する / 最初からやり直す」を表示します。
              無効にすると、途中状態があっても選択肢を出さず、最初から開始します。
            </span>
          </span>
        </label>
      </div>

      {/* ── 初回ガイド（メッセージ未作成時） ── */}
      {!loading && messages.length === 0 && (
        <GuideCard
          message="メッセージや謎を追加して、体験の流れを作りましょう。フェーズに紐づけると、参加者に LINE メッセージとして届きます。"
        />
      )}

      {/* ── 使い方ガイド ── */}
      <HelpAccordion items={[
        { title: "この画面でできること", points: [
          "フェーズごとに送信するメッセージを管理します",
          "テキスト・画像・謎など複数の種別を設定できます",
          "フェーズに関係なく反応する「共通メッセージ」も設定できます",
        ]},
        { title: "共通メッセージとは", points: [
          "フェーズに関係なく、どの状態でも反応するメッセージです",
          "例：「ヒント」キーワードでヒントを返す、「ヘルプ」で案内を返す、「やり直し」でリセット案内を返す",
          "メッセージ追加画面で「送信タイミング」→「共通メッセージ」を選んで設定します",
          "通常メッセージとの違い：フェーズ設定が不要で、常に最優先で評価されます",
        ]},
        { title: "操作手順", points: [
          "「＋ メッセージを追加」→ フェーズとキャラクターを選んで内容を入力",
          "同一フェーズに複数ある場合は「順序」の小さい順に送信されます",
          "タイプが「謎」のメッセージも「順序」の通りに送信されます",
        ]},
        { title: "注意点", points: [
          "全フェーズ共通フェーズのメッセージはどのフェーズでもキーワードに反応します",
          "有効／無効の切り替えは各メッセージの編集画面から行います",
        ]},
      ]} />

      {/* ── メッセージ一覧 ── */}
      {messages.length === 0 ? (
        <div className="card">
          <div className="empty-state">
              <p className="empty-state-title">メッセージがまだありません</p>
            <p className="empty-state-desc">
              「＋ メッセージを追加」からメッセージを作成してください。
            </p>
            {canEdit && (
              <Link
                href={`/oas/${oaId}/works/${workId}/messages/new`}
                className="btn btn-primary"
                style={{ marginTop: 8, display: "inline-block" }}
              >
                ＋ 最初のメッセージを追加
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {phaseGroups.map((group, gi) => {
            const ph = group.phase;
            const typeKey = ph?.phase_type ?? "";
            const typeColor = PHASE_TYPE_COLOR[typeKey] ?? { bg: "#f9fafb", color: "#374151", border: "#e5e7eb" };

            return (
              <div key={ph?.id ?? "__unassigned"} className="card" style={{ padding: 0, overflow: "hidden" }}>
                {/* フェーズヘッダー */}
                <div style={{
                  padding: "10px 18px",
                  background: ph ? typeColor.bg : "#fafafa",
                  borderBottom: `1px solid ${ph ? typeColor.border : "#e5e7eb"}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}>
                  <span style={{
                    fontWeight: 700, fontSize: 14,
                    color: ph ? typeColor.color : "#9ca3af",
                  }}>
                    {ph ? ph.name : "フェーズ未設定"}
                  </span>
                  {ph?.phase_type && (
                    <span style={{
                      fontSize: 10, fontWeight: 600,
                      padding: "1px 7px", borderRadius: 10,
                      background: "rgba(255,255,255,0.7)",
                      color: typeColor.color,
                      border: `1px solid ${typeColor.border}`,
                    }}>
                      {PHASE_TYPE_LABEL[ph.phase_type] ?? ph.phase_type}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>
                    {group.messages.length} 件
                  </span>
                </div>

                {/* 送信通数の警告: このフェーズに入った際の一括送信が LINE Reply 上限(5件)を超える場合 */}
                {ph && (() => {
                  const phaseMsgs = messages
                    .filter((m) => m.phase?.id === ph.id)
                    .sort((a, b) =>
                      a.sort_order - b.sort_order ||
                      new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
                      a.id.localeCompare(b.id),
                    );
                  const batch = estimatePhaseSendBatch(phaseMsgs);
                  if (batch <= LINE_REPLY_MAX) return null;
                  return (
                    <div style={{
                      padding: "8px 18px", background: "#fff7ed",
                      borderBottom: "1px solid #fed7aa", color: "#9a3412",
                      fontSize: 11, lineHeight: 1.6,
                    }}>
                      ⚠️ このフェーズは1回の送信が<strong>合計{batch}通以上</strong>になります。
                      LINE Reply API で一度に送れるのは<strong>最大5通</strong>までです。
                      6通目以降は Push API で送信されるため、月間メッセージ通数を消費します
                      （Push 上限に達している場合、6通目以降は届きません）。
                      途中に QR / 入力 / フェーズ遷移を挟むか、フェーズを分けて1回の送信を5通以内にすることを推奨します。
                    </div>
                  );
                })()}

                {/* 入場送信プレビュー（PR1・read-only）: runtime buildPhaseMessages が入場時に実際に送る順序・通数・停止位置と、
                    「QR/自由入力で辿る想定なのに entry head（＝入場でも送信される二重送信）」を可視化する。 */}
                {ph && (() => {
                  const phaseMsgs = messages
                    .filter((m) => m.phase?.id === ph.id)
                    .sort((a, b) =>
                      a.sort_order - b.sort_order ||
                      new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
                      a.id.localeCompare(b.id),
                    );
                  if (phaseMsgs.length === 0) return null;
                  const plan = computePhaseEntryPlan(phaseMsgs as unknown as EntryPlanMessage[], messages as unknown as RefMessage[]);
                  const dblHeads   = plan.heads.filter((h) => h.reachedViaNonNext);
                  const notSent    = plan.heads.filter((h) => !h.sentOnEntry);
                  const hasWarning = plan.multipleHeads || plan.sortOrderUnstable || plan.overLimit || dblHeads.length > 0 || !!plan.stoppedAtFreeInputId;
                  return (
                    <details style={{ borderBottom: "1px solid var(--border-light)", background: "#f8fafc" }}>
                      <summary style={{ padding: "8px 18px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#334155" }}>
                        📤 入場送信プレビュー（入場時に届く順・全{plan.total}通{plan.overLimit ? "・5通超" : ""}{hasWarning ? "・⚠要確認" : ""}）
                      </summary>
                      <div style={{ padding: "4px 18px 12px", fontSize: 12, lineHeight: 1.7, color: "#475569" }}>
                        <div style={{ color: "#64748b", marginBottom: 4 }}>このフェーズに入った時、以下の順で送信されます（runtime buildPhaseMessages 準拠）。</div>
                        <ol style={{ margin: "0 0 6px", paddingLeft: 20 }}>
                          {plan.sendItems.map((s) => (
                            <li key={s.index} style={{ color: s.freeInput ? "#b45309" : "#334155" }}>
                              {s.isHeadStart && (
                                <span style={{ fontSize: 10, fontWeight: 700, color: "#2563eb", marginRight: 4 }}>
                                  [entry head #{s.entryHeadIndex}{plan.heads[s.entryHeadIndex - 1]?.reachedViaNonNext ? " / QR・入力参照あり" : ""}]
                                </span>
                              )}
                              {s.label}{s.freeInput ? "（自由入力プロンプト）" : ""}
                            </li>
                          ))}
                        </ol>
                        {plan.stoppedAtFreeInputId && (
                          <div style={{ color: "#92400e", marginBottom: 4 }}>
                            ⏸ ここで入場送信は停止します。以降の entry head は入場では送られず、入力後 / QR タップで届きます。
                          </div>
                        )}
                        {hasWarning && (
                          <div style={{ marginTop: 6, padding: "8px 10px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 6, color: "#9a3412" }}>
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>警告</div>
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {plan.multipleHeads && (
                                <li>entry head が <strong>{plan.heads.length}個</strong>あります。フェーズ入場時に複数系列が一斉送信されます。</li>
                              )}
                              {plan.sortOrderUnstable && (
                                <li>entry head の <strong>sortOrder が重複</strong>しているため、送信順が不安定です（並び替えで確定してください）。</li>
                              )}
                              {dblHeads.map((h) => (
                                <li key={h.id}>
                                  「{h.label}」は <strong>QR / 自由入力応答で辿る先</strong>ですが、next で繋がれていないため、フェーズ入場時にも送信されます。
                                  QR / 入力後だけで出したい場合は、前のメッセージから next で繋ぐか、構成を見直してください。
                                </li>
                              ))}
                              {plan.stoppedAtFreeInputId && notSent.length > 0 && (
                                <li>freeInput に到達すると phase 入場送信はそこで停止します。以降の entry head（{notSent.length}件）は入場では送られません。</li>
                              )}
                              {plan.overLimit && (
                                <li>入場送信が <strong>{plan.total}通</strong>で5通を超えています。6通目以降は Push となり未達リスクがあります。</li>
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
                    </details>
                  );
                })()}

                {/* テーブル */}
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--gray-50)" }}>
                      {["タイプ", "種別", "本文", "キャラクター", "状態", "順序", "操作"].map((h, i) => (
                        <th
                          key={i}
                          style={{
                            padding: "8px 14px", textAlign: "left",
                            fontWeight: 600, color: "var(--text-muted)", fontSize: 11,
                            whiteSpace: "nowrap", letterSpacing: ".04em",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.messages.map((msg) => (
                      <Fragment key={msg.id}>
                      <tr
                        style={{ borderBottom: msg.quick_replies?.length ? "none" : "1px solid var(--border-light)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--gray-50)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                      >
                        {/* タイプ（謎 or メッセージ） */}
                        <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                          {(() => {
                            const isRiddle = msg.kind === "puzzle" || msg.message_type === "riddle";
                            const meta = isRiddle ? MSG_TYPE_META.riddle : MSG_TYPE_META.message;
                            return (
                              <span style={{
                                display: "inline-flex", alignItems: "center", gap: 3,
                                fontSize: 10, fontWeight: 600,
                                background: meta.bg, color: meta.color,
                                border: `1px solid ${meta.border}`,
                                borderRadius: 8, padding: "2px 8px",
                              }}>
                                {meta.icon} {meta.label}
                              </span>
                            );
                          })()}
                        </td>

                        {/* 種別（message_type — riddle は タイプ列で表現済みのため非表示） */}
                        <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                          {msg.message_type === "riddle" ? (
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>
                          ) : (
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: 11, color: "var(--text-secondary)",
                            }}>
                              {MESSAGE_TYPE_ICON[msg.message_type]}
                              {MESSAGE_TYPE_LABEL[msg.message_type]}
                            </span>
                          )}
                        </td>

                        {/* 本文 */}
                        <td style={{ padding: "12px 14px", maxWidth: 280 }}>
                          {msg.kind === "puzzle" ? (
                            // インライン謎: 答えと謎タイプを表示
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              {"answer" in msg && (msg as { answer?: string | null }).answer ? (
                                <span style={{ fontSize: 12, color: "#374151" }}>
                                  答え: <span style={{ fontWeight: 600 }}>{(msg as { answer?: string | null }).answer}</span>
                                </span>
                              ) : (
                                <span style={{ fontSize: 11, color: "#f97316" }}>答え未設定</span>
                              )}
                              {"puzzle_type" in msg && (msg as { puzzle_type?: string | null }).puzzle_type && (
                                <span style={{ fontSize: 10, color: "#9ca3af" }}>
                                  {(msg as { puzzle_type?: string | null }).puzzle_type}
                                </span>
                              )}
                            </div>
                          ) : msg.message_type === "riddle" ? (
                            // 外部謎参照: riddle_id ベースのコンテンツ
                            <span style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>
                              {msg.body
                                ? (msg.body.length > 28 ? msg.body.slice(0, 28) + "…" : msg.body)
                                : "📎 謎コンテンツを参照"}
                            </span>
                          ) : msg.message_type === "image" ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              {msg.asset_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={msg.asset_url}
                                  alt="画像"
                                  loading="lazy"
                                  decoding="async"
                                  style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 4, border: "1px solid #e5e5e5" }}
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                              ) : null}
                              <span style={{ fontSize: 11, color: "#9ca3af" }}>画像メッセージ</span>
                            </div>
                          ) : msg.message_type === "flex" ? (
                            <span style={{ fontSize: 12, color: "#6b7280" }}>
                              🧱 {msg.alt_text
                                ? (msg.alt_text.length > 28 ? msg.alt_text.slice(0, 28) + "…" : msg.alt_text)
                                : <span style={{ fontStyle: "italic", color: "#9ca3af" }}>Flex Message</span>}
                            </span>
                          ) : (
                            <span style={{
                              display: "-webkit-box", WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical", overflow: "hidden",
                              fontSize: 13, color: "#374151", wordBreak: "break-all",
                            }}>
                              {msg.body || <span style={{ color: "#9ca3af" }}>—</span>}
                            </span>
                          )}
                          {/* chain head のとき、連続送信通数を青バッジで表示 (= クリックで展開トグル)。
                              件数は実 chain 長（上限なし）で出す。LINE_REPLY_MAX(5) 超は
                              6通目以降が通常応答で送れないため強い警告を併記する。 */}
                          {msg.next_message_id && chainLengthFrom(messages, msg.id) > 1 && (() => {
                            const isExpanded = expandedChains.has(msg.id);
                            const chainTotal = chainLengthFrom(messages, msg.id);
                            const overLimit = chainTotal > LINE_REPLY_MAX;
                            return (
                              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4, alignItems: "flex-start" }}>
                                <button
                                  type="button"
                                  onClick={() => toggleChainExpansion(msg.id)}
                                  aria-expanded={isExpanded}
                                  style={{
                                    display: "inline-flex", alignItems: "center", gap: 4,
                                    fontSize: 10, fontWeight: 600,
                                    background: overLimit ? "#fef2f2" : "#eff6ff",
                                    color: overLimit ? "#b91c1c" : "#1d4ed8",
                                    border: `1px solid ${overLimit ? "#fecaca" : "#bfdbfe"}`,
                                    borderRadius: 10, padding: "1px 7px",
                                    cursor: "pointer",
                                  }}
                                  title={isExpanded ? "連続メッセージを閉じる" : "連続メッセージを展開して内容を確認"}
                                >
                                  {isExpanded ? "▴" : "▾"} 合計{chainTotal}通（このメッセージを含む）
                                </button>
                                {overLimit && (
                                  <span style={{ fontSize: 10, color: "#b91c1c", lineHeight: 1.5 }}>
                                    ⚠️ この連続メッセージは5通を超えています。LINE Reply API の上限を超えるため、
                                    6通目以降は通常応答では送れません。5通以内に分割するか、途中に入力 / QR / フェーズ遷移を挟んでください。
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>

                        {/* キャラクター */}
                        <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                          <CharTag character={msg.character} />
                        </td>

                        {/* 状態 (= canEdit のときはクリックで有効/無効トグル) */}
                        <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                          {canEdit ? (
                            <button
                              type="button"
                              onClick={() => handleToggleActive(msg)}
                              disabled={busyMessageId !== null}
                              aria-pressed={msg.is_active}
                              title={msg.is_active ? "クリックで無効化" : "クリックで有効化"}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 4,
                                padding: "2px 9px", borderRadius: "var(--radius-full)",
                                fontSize: 11, fontWeight: 700,
                                background: msg.is_active ? "#dcfce7" : "var(--gray-100)",
                                color:      msg.is_active ? "#166534" : "var(--text-muted)",
                                border: "1px solid transparent",
                                cursor: busyMessageId !== null ? "not-allowed" : "pointer",
                                opacity: busyMessageId !== null && busyMessageId !== msg.id ? 0.5 : 1,
                              }}
                            >
                              {msg.is_active
                                ? <><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />有効</>
                                : "無効"
                              }
                            </button>
                          ) : (
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              padding: "2px 9px", borderRadius: "var(--radius-full)",
                              fontSize: 11, fontWeight: 700,
                              background: msg.is_active ? "#dcfce7" : "var(--gray-100)",
                              color:      msg.is_active ? "#166534" : "var(--text-muted)",
                            }}>
                              {msg.is_active
                                ? <><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />有効</>
                                : "無効"
                              }
                            </span>
                          )}
                        </td>

                        {/* 順序 */}
                        <td style={{ padding: "12px 14px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
                          {msg.sort_order}
                        </td>

                        {/* 操作 (= 並び替え / 編集 / 削除) */}
                        <td style={{ padding: "12px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                          {canEdit && (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              {/* ▲ 上へ */}
                              <button
                                type="button"
                                title="上へ"
                                aria-label="上へ"
                                disabled={
                                  busyMessageId !== null ||
                                  group.messages.findIndex((m) => m.id === msg.id) === 0
                                }
                                onClick={() => handleReorderMessage(msg, "up", group.messages)}
                                className="btn btn-ghost"
                                style={{
                                  padding: "4px 8px", fontSize: 13, lineHeight: 1,
                                  ...(busyMessageId !== null ||
                                  group.messages.findIndex((m) => m.id === msg.id) === 0
                                    ? { opacity: 0.3, cursor: "not-allowed" }
                                    : {}),
                                }}
                              >▲</button>
                              {/* ▼ 下へ */}
                              <button
                                type="button"
                                title="下へ"
                                aria-label="下へ"
                                disabled={
                                  busyMessageId !== null ||
                                  group.messages.findIndex((m) => m.id === msg.id) === group.messages.length - 1
                                }
                                onClick={() => handleReorderMessage(msg, "down", group.messages)}
                                className="btn btn-ghost"
                                style={{
                                  padding: "4px 8px", fontSize: 13, lineHeight: 1,
                                  ...(busyMessageId !== null ||
                                  group.messages.findIndex((m) => m.id === msg.id) === group.messages.length - 1
                                    ? { opacity: 0.3, cursor: "not-allowed" }
                                    : {}),
                                }}
                              >▼</button>
                              {/* 編集 */}
                              <Link
                                href={`/oas/${oaId}/works/${workId}/messages/${msg.id}`}
                                className="btn btn-ghost"
                                style={{ padding: "5px 14px", fontSize: 12 }}
                              >
                                編集
                              </Link>
                              {/* 削除 */}
                              <button
                                type="button"
                                title="削除"
                                aria-label="削除"
                                disabled={busyMessageId !== null}
                                onClick={() => handleDeleteMessage(msg)}
                                style={{
                                  padding: "5px 11px", fontSize: 12, borderRadius: 6,
                                  border: "1px solid #fecaca", background: "#fff5f5",
                                  color: "#ef4444", cursor: "pointer",
                                  ...(busyMessageId !== null ? { opacity: 0.5, cursor: "not-allowed" } : {}),
                                }}
                              >削除</button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {/* chain 展開中: 2 通目以降を「中身プレビュー」として小さく並べる */}
                      {expandedChains.has(msg.id) && getChainContinuations(messages, msg.id).map((cont, ci) => (
                        <tr
                          key={`chain-${msg.id}-${cont.id}`}
                          style={{
                            background: "#f9fafb",
                            borderBottom: ci === getChainContinuations(messages, msg.id).length - 1 ? "1px solid var(--border-light)" : "1px dashed #e5e7eb",
                            fontSize: 11,
                          }}
                        >
                          {/* タイプ列: chain インデント表示 */}
                          <td style={{ padding: "8px 14px", paddingLeft: 36, color: "#94a3b8", fontSize: 10, whiteSpace: "nowrap" }}>
                            └─ {ci + 2}通目
                          </td>
                          {/* 種別 */}
                          <td style={{ padding: "8px 14px", whiteSpace: "nowrap" }}>
                            {cont.message_type === "riddle" ? (
                              <span style={{ fontSize: 10, color: "#9ca3af" }}>—</span>
                            ) : (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "#64748b" }}>
                                {MESSAGE_TYPE_ICON[cont.message_type]}
                                {MESSAGE_TYPE_LABEL[cont.message_type]}
                              </span>
                            )}
                          </td>
                          {/* 本文プレビュー */}
                          <td style={{ padding: "8px 14px", maxWidth: 280 }}>
                            {cont.message_type === "image" ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                {cont.asset_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={cont.asset_url}
                                    alt="画像"
                                    loading="lazy"
                                    decoding="async"
                                    style={{ width: 36, height: 27, objectFit: "cover", borderRadius: 3, border: "1px solid #e5e7eb" }}
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                  />
                                ) : null}
                                <span style={{ fontSize: 10, color: "#9ca3af" }}>画像メッセージ</span>
                              </div>
                            ) : (
                              <span style={{
                                display: "-webkit-box", WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical", overflow: "hidden",
                                fontSize: 11, color: "#475569", wordBreak: "break-all",
                              }}>
                                {cont.body || <span style={{ color: "#cbd5e1" }}>—</span>}
                              </span>
                            )}
                            {/* QR / quickReply が設定済みなら小さく注記 */}
                            {cont.quick_replies && cont.quick_replies.length > 0 && (
                              <span style={{
                                marginLeft: 6, display: "inline-block",
                                fontSize: 9, color: "#64748b",
                                background: "#fff", border: "1px solid #e2e8f0",
                                borderRadius: 6, padding: "0 5px", verticalAlign: "middle",
                              }}>
                                QR {cont.quick_replies.length}
                              </span>
                            )}
                            {/* Phase 2c: 演出設定有無を小さく注記 */}
                            {hasAnyTiming(cont) && (
                              <span
                                title={summarizeTiming(cont)}
                                style={{
                                  marginLeft: 6, display: "inline-block",
                                  fontSize: 9, color: "#7c3aed",
                                  background: "#f5f3ff", border: "1px solid #ddd6fe",
                                  borderRadius: 6, padding: "0 5px", verticalAlign: "middle",
                                }}
                              >
                                演出: 設定あり
                              </span>
                            )}
                          </td>
                          {/* キャラクター */}
                          <td style={{ padding: "8px 14px", whiteSpace: "nowrap" }}>
                            <CharTag character={cont.character} />
                          </td>
                          {/* 状態 / 順序 / 編集 列は continuation では空 (= 親の塊に内包されているため独立操作対象にしない) */}
                          <td style={{ padding: "8px 14px", whiteSpace: "nowrap", color: "#cbd5e1", fontSize: 10 }}>—</td>
                          <td style={{ padding: "8px 14px", textAlign: "center", color: "#cbd5e1", fontSize: 10 }}>—</td>
                          <td style={{ padding: "8px 14px" }} />
                        </tr>
                      ))}
                      <BranchRows
                        msg={msg}
                        allMessages={messages}
                        transitions={transitions}
                        phases={phases}
                        colSpan={7}
                      />
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}

          <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right", padding: "0 4px 4px" }}>
            合計 {headMessageCount} 件
          </div>
        </div>
      )}
      </>)}
    </>
  );
}
