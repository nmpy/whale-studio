"use client";

// src/app/oas/[id]/works/[workId]/messages/page.tsx

import { Fragment, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { TLink as Link } from "@/components/TLink";
import { workApi, messageApi, phaseApi, transitionApi, getDevToken } from "@/lib/api-client";
import { HelpAccordion } from "@/components/HelpAccordion";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { MessageWithRelations, MessageType, PhaseWithCounts, TransitionWithPhases, QuickReplyItem } from "@/types";

const MESSAGE_TYPE_LABEL: Record<MessageType, string> = {
  text:     "テキスト",
  image:    "画像",
  riddle:   "謎",
  video:    "動画",
  carousel: "カルーセル",
  voice:    "ボイス",
};

const MESSAGE_TYPE_ICON: Record<MessageType, string> = {
  text:     "💬",
  image:    "🖼",
  riddle:   "🔍",
  video:    "🎬",
  carousel: "🎠",
  voice:    "🎙",
};

const PHASE_TYPE_LABEL: Record<string, string> = {
  start:   "開始",
  normal:  "通常",
  ending:  "エンディング",
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
      }}>
        👤
      </span>
    );
  }

  if (character.icon_image_url) {
    // 画像アイコン
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={character.icon_image_url}
        alt={character.name}
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
};

const KIND_META: Record<string, { label: string; icon: string; bg: string; color: string }> = {
  normal:   { label: "通常",     icon: "📨", bg: "#f0f9ff", color: "#0369a1" },
  start:    { label: "開始演出", icon: "🎬", bg: "#fef3c7", color: "#92400e" },
  response: { label: "応答",     icon: "💬", bg: "#f0fdf4", color: "#166534" },
  hint:     { label: "ヒント",   icon: "💡", bg: "#faf5ff", color: "#7e22ce" },
  puzzle:   { label: "謎",       icon: "🧩", bg: "#fff7ed", color: "#c2410c" },
};

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
  return "(メッセージ)";
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
          <BranchChip color="orange">💬 {msgPreview(firstResp)}</BranchChip>
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
            → {msgPreview(directTargetMsg)}
          </BranchChip>
        </>
      ) : firstTrans ? (
        <>
          <BranchArrow />
          <BranchChip color="purple">→ {firstTrans.to_phase.name}</BranchChip>
        </>
      ) : chainMsg ? (
        <>
          <BranchArrow />
          <BranchChip color="gray">→ {msgPreview(chainMsg)}</BranchChip>
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
  const [activeTab, setActiveTab]       = useState<Tab>("messages");
  const [workTitle, setWorkTitle]       = useState("");
  const [welcomeMsg, setWelcomeMsg]     = useState<string | null>(null);
  const [messages, setMessages]         = useState<MessageWithRelations[]>([]);
  const [phases, setPhases]             = useState<PhaseWithCounts[]>([]);
  const [transitions, setTransitions]   = useState<TransitionWithPhases[]>([]);
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState<string | null>(null);

  useEffect(() => {
    const token = getDevToken();
    setLoading(true);
    setLoadError(null);
    Promise.all([
      workApi.get(token, workId),
      messageApi.list(token, workId, { with_relations: true }) as Promise<MessageWithRelations[]>,
      phaseApi.list(token, workId),
      transitionApi.listByWork(token, workId),
    ])
      .then(([w, list, phaseList, transList]) => {
        setWorkTitle(w.title);
        setWelcomeMsg(w.welcome_message ?? "");
        setMessages(list);
        setPhases(phaseList.sort((a, b) => a.sort_order - b.sort_order));
        setTransitions(transList);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [workId]);

  // フェーズごとにメッセージをグルーピング
  function buildPhaseGroups(): PhaseGroup[] {
    const phaseIds = new Set(phases.map((p) => p.id));
    const groups: PhaseGroup[] = phases
      .map((ph) => ({
        phase: ph,
        messages: messages
          .filter((m) => m.phase?.id === ph.id)
          .sort((a, b) => a.sort_order - b.sort_order),
      }))
      .filter((g) => g.messages.length > 0);

    const unassigned = messages
      .filter((m) => !m.phase || !phaseIds.has(m.phase.id))
      .sort((a, b) => a.sort_order - b.sort_order);

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
      { label: "メッセージ・謎" },
    ]} />
  );

  if (loading) {
    return (
      <>
        <div className="page-header">
          <div>{breadcrumb}<h2>メッセージ・謎</h2></div>
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
          <div>{breadcrumb}<h2>メッセージ・謎</h2></div>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  const phaseGroups = buildPhaseGroups();

  // ── タブ共通スタイル ────────────────────────────────
  const tabStyle = (tab: Tab): React.CSSProperties => ({
    padding: "9px 20px",
    fontSize: 13,
    fontWeight: activeTab === tab ? 700 : 500,
    color: activeTab === tab ? "#06C755" : "var(--text-secondary)",
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
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          {breadcrumb}
          <h2>{activeTab === "welcome" ? "あいさつメッセージ" : "メッセージ・謎"}</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            {activeTab === "welcome"
              ? "友だち追加・シナリオ開始前に送る特別なメッセージです"
              : "フェーズごとに送信するメッセージを管理します"}
          </p>
        </div>
        {activeTab === "messages" && (
          <Link href={`/oas/${oaId}/works/${workId}/messages/new`} className="btn btn-primary">
            ＋ メッセージを追加
          </Link>
        )}
        {activeTab === "welcome" && (
          <a
            href={`/oas/${oaId}/account#welcome-message`}
            className="btn btn-primary"
            style={{ textDecoration: "none" }}
          >
            設定で編集する →
          </a>
        )}
      </div>

      {/* ── タブバー ── */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid var(--border-light)",
        marginBottom: 20,
        gap: 0,
      }}>
        <button type="button" style={tabStyle("messages")} onClick={() => setActiveTab("messages")}>
          💬 メッセージ・謎
          <span style={{
            fontSize: 10, fontWeight: 700,
            background: activeTab === "messages" ? "#dcfce7" : "#f3f4f6",
            color: activeTab === "messages" ? "#166534" : "#9ca3af",
            borderRadius: 8, padding: "0 5px",
          }}>
            {messages.length}
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
                  { icon: "✉️", text: "友だち追加時に自動送信" },
                  { icon: "🎯", text: "シナリオ開始前の一度きり" },
                  { icon: "⚙️", text: "OA設定で一元管理" },
                ].map(({ icon, text }) => (
                  <span key={text} style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 11, color: "#059669", fontWeight: 600,
                  }}>
                    <span>{icon}</span>{text}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 現在の設定 */}
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
                  }}>✓ 設定済み</span>
                ) : (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: "#dc2626",
                    background: "#fef2f2", padding: "1px 8px", borderRadius: 10,
                    border: "1px solid #fecaca",
                  }}>未設定</span>
                )}
              </div>
            </div>

            {welcomeMsg?.trim() ? (
              <>
                {/* メッセージ本文プレビュー（LINEの吹き出し風） */}
                <div style={{
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 12,
                  padding: "16px 18px",
                  marginBottom: 16,
                  position: "relative",
                }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: "#16a34a",
                    letterSpacing: 0.5, marginBottom: 8,
                    textTransform: "uppercase",
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
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  background: "#f8fafc", borderRadius: 8, padding: "10px 14px",
                  fontSize: 12, color: "#64748b",
                }}>
                  <span>ℹ️</span>
                  <span>
                    変更する場合は「設定で編集する」ボタンから OA 設定ページへ移動してください。
                    あいさつメッセージは OA 単位で管理されています。
                  </span>
                </div>
              </>
            ) : (
              <div style={{
                background: "#fffbeb", border: "1px solid #fde68a",
                borderRadius: 10, padding: "24px 20px",
                textAlign: "center",
              }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
                <p style={{ fontWeight: 700, fontSize: 14, color: "#92400e", margin: "0 0 6px" }}>
                  あいさつメッセージが未設定です
                </p>
                <p style={{ fontSize: 12, color: "#b45309", margin: "0 0 16px", lineHeight: 1.7 }}>
                  友だち追加時に何も届かない状態です。<br />
                  ユーザーへの最初の接触なので、必ず設定することをおすすめします。
                </p>
                <a
                  href={`/oas/${oaId}/account#welcome-message`}
                  className="btn btn-primary"
                  style={{ textDecoration: "none" }}
                >
                  今すぐ設定する →
                </a>
              </div>
            )}

            {welcomeMsg?.trim() && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                <a
                  href={`/oas/${oaId}/account#welcome-message`}
                  className="btn btn-primary"
                  style={{ textDecoration: "none" }}
                >
                  設定で編集する →
                </a>
              </div>
            )}
          </div>

          {/* 使い方ガイド */}
          <HelpAccordion items={[
            { icon: "📋", title: "あいさつメッセージの使い方", points: [
              "「今日からあなたの相棒になる謎解き体験へようこそ！」のような導入文を設定します",
              "シナリオの世界観・始め方をユーザーに伝える場として活用してください",
              "「はじめる」と送ることでシナリオが開始される旨を明記すると分かりやすいです",
            ]},
            { icon: "⚙️", title: "編集場所について", points: [
              "あいさつメッセージは「OA設定 → アカウント情報」で管理しています",
              "同じ OA の複数の作品で共通のあいさつを使う設計になっています",
            ]},
          ]} />
        </div>
      )}

      {/* ══════════════════════════════════════════════
          タブ: メッセージ・謎
      ══════════════════════════════════════════════ */}
      {activeTab === "messages" && (<>
      {/* ── 使い方ガイド ── */}
      <HelpAccordion items={[
        { icon: "✅", title: "この画面でできること", points: [
          "フェーズごとに送信するメッセージを管理します",
          "テキスト・画像・謎など複数の種別を設定できます",
          "フェーズに関係なく反応する「共通メッセージ」も設定できます",
        ]},
        { icon: "💬", title: "共通メッセージとは", points: [
          "フェーズに関係なく、どの状態でも反応するメッセージです",
          "例：「ヒント」キーワードでヒントを返す、「ヘルプ」で案内を返す、「やり直し」でリセット案内を返す",
          "メッセージ追加画面で「メッセージ役割」→「共通メッセージ」を選んで設定します",
          "通常メッセージとの違い：フェーズ設定が不要で、常に最優先で評価されます",
        ]},
        { icon: "👆", title: "操作手順", points: [
          "「＋ メッセージを追加」→ フェーズとキャラクターを選んで内容を入力",
          "同一フェーズに複数ある場合は「順序」の小さい順に送信されます",
          "種別が「謎」の場合は謎管理で作成した謎を選択します",
        ]},
        { icon: "⚠️", title: "注意点", points: [
          "フェーズ未設定かつ共通メッセージでないものは、どのフェーズでも送信されません",
          "有効／無効の切り替えは各メッセージの編集画面から行います",
        ]},
      ]} />

      {/* ── メッセージ一覧 ── */}
      {messages.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">💬</div>
            <p className="empty-state-title">メッセージがまだありません</p>
            <p className="empty-state-desc">
              「＋ メッセージを追加」からメッセージを作成してください。
            </p>
            <Link
              href={`/oas/${oaId}/works/${workId}/messages/new`}
              className="btn btn-primary"
              style={{ marginTop: 8, display: "inline-block" }}
            >
              ＋ 最初のメッセージを追加
            </Link>
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

                {/* テーブル */}
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--gray-50)" }}>
                      {["種別", "役割", "本文", "キャラクター", "状態", "順序", ""].map((h, i) => (
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
                        {/* 種別 */}
                        <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            fontSize: 11, color: "var(--text-secondary)",
                          }}>
                            {MESSAGE_TYPE_ICON[msg.message_type]}
                            {MESSAGE_TYPE_LABEL[msg.message_type]}
                          </span>
                        </td>

                        {/* 役割（kind） */}
                        <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                          {(() => {
                            const k = msg.kind ?? "normal";
                            const meta = KIND_META[k] ?? KIND_META.normal;
                            return (
                              <span style={{
                                display: "inline-flex", alignItems: "center", gap: 3,
                                fontSize: 10, fontWeight: 600,
                                background: meta.bg, color: meta.color,
                                borderRadius: 8, padding: "2px 7px",
                              }}>
                                {meta.icon} {meta.label}
                              </span>
                            );
                          })()}
                        </td>

                        {/* 本文 */}
                        <td style={{ padding: "12px 14px", maxWidth: 280 }}>
                          {msg.kind === "puzzle" ? (
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
                          ) : msg.message_type === "image" ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              {msg.asset_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={msg.asset_url}
                                  alt="画像"
                                  style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 4, border: "1px solid #e5e5e5" }}
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                              ) : null}
                              <span style={{ fontSize: 11, color: "#9ca3af" }}>画像メッセージ</span>
                            </div>
                          ) : (
                            <span style={{
                              display: "-webkit-box", WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical", overflow: "hidden",
                              fontSize: 13, color: "#374151", wordBreak: "break-all",
                            }}>
                              {msg.body || <span style={{ color: "#9ca3af" }}>—</span>}
                            </span>
                          )}
                        </td>

                        {/* キャラクター */}
                        <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                          <CharTag character={msg.character} />
                        </td>

                        {/* 状態 */}
                        <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
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
                        </td>

                        {/* 順序 */}
                        <td style={{ padding: "12px 14px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
                          {msg.sort_order}
                        </td>

                        {/* 編集 */}
                        <td style={{ padding: "12px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <Link
                            href={`/oas/${oaId}/works/${workId}/messages/${msg.id}`}
                            className="btn btn-ghost"
                            style={{ padding: "5px 14px", fontSize: 12 }}
                          >
                            編集
                          </Link>
                        </td>
                      </tr>
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
            合計 {messages.length} 件
          </div>
        </div>
      )}
      </>)}
    </>
  );
}
