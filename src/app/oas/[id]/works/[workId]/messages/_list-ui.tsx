// src/app/oas/[id]/works/[workId]/messages/_list-ui.tsx
//
// メッセージ一覧の **表示専用** プレゼンテーション部品（旧 page.tsx から抽出・ロジック不変）。
//   - 旧テーブル UI と 再設計カード UI の両方から再利用する共有部品。
//   - 純粋な描画のみ（state を持たない / API を叩かない）。送信・保存・遷移などのロジックは無関係。
//
// 抽出元: page.tsx のローカル定義（CharIcon / CharTag / BranchChip / FlowPill /
//   FlowStatusCell / BranchItemRow / msgPreview など）。挙動は完全維持。
//   FlowStatusCell のみ `mode` prop を追加（カード詳細で「警告以外（補足/遷移先）」だけ出すため）。

import type { MessageWithRelations, MessageType, PhaseWithCounts, TransitionWithPhases, QuickReplyItem } from "@/types";
import { chainSizeFrom } from "./_list-helpers";
import type { MessageFlowInfo, FlowLink } from "@/lib/message-flow-status";

export const MESSAGE_TYPE_LABEL: Record<MessageType, string> = {
  text:     "テキスト",
  image:    "画像",
  riddle:   "—",       // タイプ列で "謎" として表示するため種別列では非表示
  video:    "動画",
  carousel: "カルーセル",
  voice:    "ボイス",
  flex:     "Flex Message",
  call_request: "通話リクエスト",
};

export const MESSAGE_TYPE_ICON: Record<MessageType, string> = {
  text:     "",
  image:    "🖼",
  riddle:   "",         // 同上
  video:    "🎬",
  carousel: "🎠",
  voice:    "🎙",
  flex:     "🧱",
  call_request: "📞",
};

export const PHASE_TYPE_LABEL: Record<string, string> = {
  start:   "開始",
  normal:  "通常",
  ending:  "エンディング",
  global:  "全フェーズ共通",
};

export const PHASE_TYPE_COLOR: Record<string, { bg: string; color: string; border: string }> = {
  start:   { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  normal:  { bg: "#f0fdf4", color: "#166534", border: "#bbf7d0" },
  ending:  { bg: "#fdf4ff", color: "#7e22ce", border: "#e9d5ff" },
  global:  { bg: "#fffbeb", color: "#b45309", border: "#fcd34d" },
};

/** タイプバッジ: 謎（puzzle / riddle）か メッセージ かの二択 */
export const MSG_TYPE_META = {
  riddle:  { label: "謎",       icon: "🧩", bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
  message: { label: "メッセージ", icon: "",   bg: "#f0f9ff", color: "#0369a1", border: "#bae6fd" },
} as const;

export function CharIcon({ character }: { character: MessageWithRelations["character"]; size?: number }) {
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

export function CharTag({ character }: { character: MessageWithRelations["character"] }) {
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

// ── ブランチフロー ────────────────────────────────────────

const BRANCH_CHIP_PALETTE = {
  blue:   { bg: "#dbeafe", color: "#1e40af", border: "#bfdbfe" },
  orange: { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
  purple: { bg: "#f5f3ff", color: "#6d28d9", border: "#ddd6fe" },
  gray:   { bg: "#f1f5f9", color: "#475569", border: "#e2e8f0" },
  dim:    { bg: "#f9fafb", color: "#9ca3af", border: "#e5e7eb" },
} as const;

export function BranchChip({
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

export function BranchArrow() {
  return <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0 }}>→</span>;
}

/** メッセージ本文の短いプレビュー文字列 */
export function msgPreview(m: MessageWithRelations | undefined): string {
  if (!m) return "";
  if (m.body) return m.body.length > 28 ? m.body.slice(0, 28) + "…" : m.body;
  if (m.message_type === "image")    return "🖼 画像";
  if (m.message_type === "video")    return "🎬 動画";
  if (m.message_type === "voice")    return "🎙 ボイス";
  if (m.message_type === "carousel") return "🎠 カルーセル";
  if (m.message_type === "flex")     return m.alt_text ? `🧱 ${m.alt_text.length > 24 ? m.alt_text.slice(0, 24) + "…" : m.alt_text}` : "🧱 Flex Message";
  return "(メッセージ)";
}

/** カード本文プレビュー（handoff 準拠で 60 字目安。2行クランプと併用するので長文でも伸びすぎない）。 */
export function cardPreview(m: MessageWithRelations | undefined): string {
  if (!m) return "";
  if (m.body) return m.body.length > 60 ? m.body.slice(0, 60) + "…" : m.body;
  return msgPreview(m);
}

/** 分岐フローの「結果」表示用: キャラクター名 + 本文冒頭。例: くらげさん「あっ」
 *  キャラクター未設定なら本文プレビューのみ。 */
export function msgPreviewWithChar(m: MessageWithRelations | undefined): string {
  if (!m) return "";
  const body = msgPreview(m);
  const name = m.character?.name;
  return name ? `${name}「${body}」` : body;
}

/** 導線バッジの共通ピル。tone で配色を切り替える（warn=見落としにくく、info/neutral=控えめ）。 */
export function FlowPill({ tone, title, children }: { tone: "warn" | "info" | "neutral"; title?: string; children: React.ReactNode }) {
  const palette = {
    warn:    { bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
    info:    { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
    neutral: { bg: "#f8fafc", color: "#475569", border: "#e2e8f0" },
  }[tone];
  return (
    <span
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        fontSize: 10, fontWeight: tone === "warn" ? 700 : 600,
        background: palette.bg, color: palette.color,
        border: `1px solid ${palette.border}`,
        borderRadius: 8, padding: "1px 7px", lineHeight: 1.5, whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export const FLOW_LINK_PREFIX: Record<FlowLink["type"], string> = {
  free_input:      "入力後",
  puzzle_phase:    "正解後",
  checkin_message: "到着後",
  checkin_phase:   "到着後",
  qr_message:      "クイックリプライ",
  qr_phase:        "クイックリプライ",
  chain_external:  "連続",
};

/** メッセージの「導線状態」サブ情報（判定は message-flow-status.ts の純関数。ここは表示のみ）。
 *  mode:
 *    - "all"  (既定): 警告 + 補足バッジ + 遷移先（旧テーブル互換）
 *    - "info"        : 警告を出さず、補足バッジ + 遷移先のみ（カード詳細用。警告はカード本体で常時表示するため重複回避） */
export function FlowStatusCell({
  info, msgById, phaseById, mode = "all", allHint = false,
}: {
  info:      MessageFlowInfo | undefined;
  msgById:   Map<string, MessageWithRelations>;
  phaseById: Map<string, PhaseWithCounts>;
  mode?:     "all" | "info";
  /** 対象 QR がすべて action="hint"（謎のヒント）のとき、QRバッジを「ヒントあり」と表示する。表示のみ。 */
  allHint?:  boolean;
}) {
  if (!info) return null;
  const showWarn = mode === "all";

  const linkLabel = (link: FlowLink): { text: string; broken: boolean } => {
    const prefix = FLOW_LINK_PREFIX[link.type];
    if (!link.targetId || !link.exists) return { text: `${prefix} → 遷移先未設定`, broken: true };
    const name =
      link.targetType === "message"
        ? (msgPreview(msgById.get(link.targetId)) || "メッセージ")
        : (phaseById.get(link.targetId)?.name ?? "フェーズ");
    return { text: `${prefix} → ${name}`, broken: false };
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6, alignItems: "center" }}>
      {/* 警告（見落としにくく） — mode="info" では非表示（カード本体で常時表示するため） */}
      {showWarn && info.missingKeyword && <FlowPill tone="warn" title="応答キーワードが必須なのに未入力です">⚠ キーワード未設定</FlowPill>}
      {showWarn && info.hasBrokenLink  && <FlowPill tone="warn" title="設定された遷移先が未指定または存在しません">⚠ 遷移先未設定</FlowPill>}
      {showWarn && info.unreferenced   && <FlowPill tone="warn" title="どこからも参照されず、キーワードも無いため配信されません">⚠ 未接続</FlowPill>}

      {/* 種別・分岐バッジ（控えめ） */}
      {info.isStart       && <FlowPill tone="info">開始</FlowPill>}
      {info.hasQrBranch   && <FlowPill tone="neutral">{allHint ? "ヒントあり" : "クイックリプライ分岐あり"}</FlowPill>}
      {!info.hasQrBranch && info.hasQuickReply && <FlowPill tone="neutral">{allHint ? "ヒントあり" : "クイックリプライあり"}</FlowPill>}
      {info.hasFreeInput  && <FlowPill tone="neutral">自由入力あり</FlowPill>}
      {info.hasImageTap   && <FlowPill tone="neutral">画像タップあり</FlowPill>}

      {/* 次の遷移先 */}
      {info.nextLinks.length > 0
        ? info.nextLinks.map((link, i) => {
            const { text, broken } = linkLabel(link);
            return (
              <span key={i} style={{ fontSize: 10, color: broken ? "#b91c1c" : "#64748b", whiteSpace: "nowrap" }}>
                {text}
              </span>
            );
          })
        : <span style={{ fontSize: 10, color: "#cbd5e1", whiteSpace: "nowrap" }}>次の遷移先 → —</span>}
    </div>
  );
}

export const normKw = (s: string) => s.trim().toLowerCase().normalize("NFKC");

/** QR ボタン 1 件分の「入力 → 応答 → 結果」行（div ベース・テーブル/カード両用）。 */
export function BranchItemRow({
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
