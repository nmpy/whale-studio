// src/app/oas/[id]/works/[workId]/messages/_form.tsx
// 共有メッセージフォーム（新規・編集ページで使用）

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { phaseApi, characterApi, riddleApi, messageApi, getDevToken } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { PhaseWithCounts, Character, QuickReplyItem, QuickReplyAction } from "@/types";
import type { Riddle } from "@/types";

// ── 拡張メッセージ種別 ────────────────────────────────────

export type ExtendedMessageType =
  | "text"
  | "image"
  | "riddle"
  | "video"
  | "carousel"
  | "voice";

// ── 定数 ────────────────────────────────────────────────

export const MESSAGE_TYPE_OPTIONS: {
  value: ExtendedMessageType;
  label: string;
  icon: string;
  desc: string;
}[] = [
  { value: "text",     label: "テキスト",     icon: "💬", desc: "テキストメッセージ" },
  { value: "image",    label: "画像",         icon: "🖼",  desc: "画像メッセージ" },
  { value: "video",    label: "動画",         icon: "🎬", desc: "動画メッセージ" },
  { value: "carousel", label: "カルーセル",   icon: "🎠", desc: "カルーセルメッセージ" },
  { value: "voice",    label: "ボイス",       icon: "🎙", desc: "ボイスメッセージ" },
];

/** 謎の配信形式セレクター用（riddle / voice / flex は謎では使用しない） */
const PUZZLE_DELIVERY_TYPE_OPTIONS = MESSAGE_TYPE_OPTIONS.filter(
  (opt) => ["text", "image", "video", "carousel"].includes(opt.value)
);

// ── カルーセルカード型 ────────────────────────────────────

export interface MessageCarouselCard {
  image_url:    string;
  title:        string;
  body:         string;
  button_label: string;
  button_url:   string;
}

const EMPTY_CAROUSEL_CARD: MessageCarouselCard = {
  image_url:    "",
  title:        "",
  body:         "",
  button_label: "",
  button_url:   "",
};

// ── FormState ────────────────────────────────────────────

export type MessageKind = "start" | "normal" | "response" | "hint" | "puzzle" | "global";
export type AnswerMatchType = "exact" | "ignore_punctuation" | "normalize_width";
export type CorrectAction   = "text" | "text_and_transition" | "transition";

export interface MessageFormState {
  trigger_keyword: string;
  target_segment:  string;
  phase_id:        string;
  character_id:    string;
  message_type:    ExtendedMessageType;
  /** メッセージ役割種別 */
  kind:            MessageKind;
  body:            string;
  asset_url:       string;
  notify_text:     string;
  riddle_id:       string;
  carousel_items:  MessageCarouselCard[];
  quick_replies:   QuickReplyItem[];
  /** 連続送信チェーン先メッセージ ID（空文字 = チェーンなし） */
  next_message_id: string;
  sort_order:      number;
  is_active:       boolean;
  // ── 謎（puzzle）専用フィールド ──
  puzzle_type:           string;
  answer:                string;
  puzzle_hint_text:      string;
  answer_match_type:     AnswerMatchType[];
  correct_action:        CorrectAction;
  correct_text:          string;
  incorrect_text:           string;
  incorrect_quick_replies:  QuickReplyItem[];
  correct_next_phase_id:    string;
}

export const EMPTY_MESSAGE_FORM: MessageFormState = {
  trigger_keyword: "",
  target_segment:  "",
  phase_id:        "",
  character_id:    "",
  message_type:    "text",
  kind:            "normal",
  body:            "",
  asset_url:       "",
  notify_text:     "",
  riddle_id:       "",
  carousel_items:  [],
  quick_replies:   [],
  next_message_id: "",
  sort_order:      0,
  is_active:       true,
  // puzzle defaults
  puzzle_type:           "",
  answer:                "",
  puzzle_hint_text:      "",
  answer_match_type:     ["exact"],
  correct_action:        "text",
  correct_text:          "",
  incorrect_text:          "",
  incorrect_quick_replies: [],
  correct_next_phase_id:   "",
};

// ── コンバーター ──────────────────────────────────────────

export function msgToFormState(msg: {
  trigger_keyword?:      string | null;
  target_segment?:       string | null;
  phase_id?:             string | null;
  character_id?:         string | null;
  message_type?:         string;
  kind?:                 string | null;
  body?:                 string | null;
  asset_url?:            string | null;
  notify_text?:          string | null;
  riddle_id?:            string | null;
  quick_replies?:        QuickReplyItem[] | null;
  next_message_id?:      string | null;
  puzzle_type?:          string | null;
  answer?:               string | null;
  puzzle_hint_text?:     string | null;
  answer_match_type?:    string[] | null;
  correct_action?:       string | null;
  correct_text?:            string | null;
  incorrect_text?:          string | null;
  incorrect_quick_replies?: QuickReplyItem[] | null;
  correct_next_phase_id?:   string | null;
  sort_order?:              number;
  is_active?:               boolean;
}): MessageFormState {
  // Parse carousel items from body JSON if message_type is carousel
  let carousel_items: MessageCarouselCard[] = [];
  if (msg.message_type === "carousel" && msg.body) {
    try {
      const parsed = JSON.parse(msg.body);
      if (Array.isArray(parsed)) carousel_items = parsed as MessageCarouselCard[];
    } catch {
      carousel_items = [];
    }
  }

  return {
    trigger_keyword:       msg.trigger_keyword ?? "",
    target_segment:        msg.target_segment  ?? "",
    phase_id:              msg.phase_id        ?? "",
    character_id:          msg.character_id    ?? "",
    message_type:          (msg.message_type as ExtendedMessageType) ?? "text",
    kind:                  (msg.kind as MessageKind) ?? "normal",
    body:                  msg.message_type === "carousel" ? "" : (msg.body ?? ""),
    asset_url:             msg.asset_url       ?? "",
    notify_text:           msg.notify_text     ?? "",
    riddle_id:             msg.riddle_id       ?? "",
    carousel_items,
    quick_replies:         msg.quick_replies   ?? [],
    next_message_id:       msg.next_message_id ?? "",
    sort_order:            msg.sort_order      ?? 0,
    is_active:             msg.is_active       ?? true,
    puzzle_type:           msg.puzzle_type     ?? "",
    answer:                msg.answer          ?? "",
    puzzle_hint_text:      msg.puzzle_hint_text ?? "",
    answer_match_type:     (msg.answer_match_type ?? ["exact"]) as AnswerMatchType[],
    correct_action:        (msg.correct_action ?? "text") as CorrectAction,
    correct_text:            msg.correct_text    ?? "",
    incorrect_text:          msg.incorrect_text  ?? "",
    incorrect_quick_replies: msg.incorrect_quick_replies ?? [],
    correct_next_phase_id:   msg.correct_next_phase_id ?? "",
  };
}

export function formStateToMsgBody(form: MessageFormState) {
  const isPuzzle  = form.kind === "puzzle";
  const isGlobal  = form.kind === "global";
  const payload = {
    trigger_keyword:  form.trigger_keyword || null,
    target_segment:   form.target_segment  || null,
    // 共通メッセージはフェーズ不問のため phase_id を null にする
    phase_id:         isGlobal ? null : (form.phase_id || null),
    character_id:     form.character_id    || null,
    // puzzle も message_type をそのまま使う（画像・動画・カルーセル謎に対応）
    message_type:     form.message_type,
    // global は API に kind="response" + phase_id=null で送信
    kind:             (isGlobal ? "response" : form.kind) as Exclude<MessageKind, "global">,
    body:
      form.message_type === "carousel"
        ? JSON.stringify(form.carousel_items)
        : form.message_type === "text"
        ? form.body || undefined
        : undefined,
    asset_url:         (form.message_type === "image" || form.message_type === "video" || form.message_type === "voice")
      ? form.asset_url || undefined
      : undefined,
    notify_text:       form.message_type !== "text"
      ? form.notify_text || undefined
      : undefined,
    riddle_id:         !isPuzzle ? (form.riddle_id || null) : null,
    quick_replies:     form.quick_replies.length > 0 ? form.quick_replies : null,
    next_message_id:   form.next_message_id || null,
    sort_order:        form.sort_order,
    is_active:         form.is_active,
    // puzzle fields
    puzzle_type:           isPuzzle ? (form.message_type as "text" | "image" | "video" | "carousel") || null : null,
    answer:                isPuzzle ? form.answer || null : null,
    puzzle_hint_text:      isPuzzle ? form.puzzle_hint_text || null : null,
    answer_match_type:     isPuzzle ? form.answer_match_type : ["exact"],
    correct_action:        isPuzzle ? form.correct_action || null : null,
    correct_text:          isPuzzle ? form.correct_text || null : null,
    incorrect_text:          isPuzzle ? form.incorrect_text || null : null,
    incorrect_quick_replies: isPuzzle && form.incorrect_quick_replies.length > 0 ? form.incorrect_quick_replies : null,
    correct_next_phase_id:   isPuzzle ? form.correct_next_phase_id || null : null,
  };
  console.log("[formStateToMsgBody] payload:", JSON.stringify(payload, null, 2));
  return payload;
}

// ── バリデーション ────────────────────────────────────────

export function validateMessageForm(form: MessageFormState): string | null {
  // ── 共通メッセージバリデーション ──
  if (form.kind === "global") {
    if (!form.trigger_keyword.trim()) {
      return "共通メッセージにはキーワード（応答キーワード）が必須です";
    }
    if (form.message_type === "text" && !form.body.trim()) {
      return "テキスト本文は必須です";
    }
  }
  // ── 謎（puzzle）バリデーション ──
  if (form.kind === "puzzle") {
    // 謎の問題コンテンツ（配信形式ごと）
    if (form.message_type === "text" && !form.body.trim()) {
      return "謎の本文は必須です";
    }
    if (form.message_type === "image" && !form.asset_url.trim()) {
      return "画像 URL は必須です";
    }
    if (form.message_type === "video" && !form.asset_url.trim()) {
      return "動画 URL は必須です";
    }
    if (form.message_type === "carousel" && form.carousel_items.length === 0) {
      return "カードを1枚以上追加してください";
    }
    // 謎の答え・アクション設定
    if (!form.answer.trim()) return "答えは必須です";
    if (form.answer_match_type.length === 0) return "照合方法を1つ以上選択してください";
    if (!form.correct_action) return "正解時アクションを選択してください";
    if (
      (form.correct_action === "text" || form.correct_action === "text_and_transition") &&
      !form.correct_text.trim()
    ) {
      return "正解メッセージは必須です（アクション: テキスト返信）";
    }
    if (
      (form.correct_action === "transition" || form.correct_action === "text_and_transition") &&
      !form.correct_next_phase_id
    ) {
      return "遷移先フェーズを選択してください";
    }
    return null;
  }
  // ── 通常メッセージバリデーション ──
  if (form.message_type === "text" && !form.body.trim()) {
    return "テキスト本文は必須です";
  }
  if (
    (form.message_type === "image" ||
      form.message_type === "video" ||
      form.message_type === "voice") &&
    !form.asset_url.trim()
  ) {
    return `${
      form.message_type === "image"
        ? "画像"
        : form.message_type === "video"
        ? "動画"
        : "音声"
    } URL は必須です`;
  }
  if (form.message_type === "riddle" && !form.riddle_id) {
    return "謎を選択してください";
  }
  if (form.message_type === "carousel" && form.carousel_items.length === 0) {
    return "カードを1枚以上追加してください";
  }
  return null;
}

// ── Props ────────────────────────────────────────────────

interface MessageFormProps {
  oaId:        string;
  workId:      string;
  workTitle:   string;
  initialForm: MessageFormState;
  isNew:       boolean;
  submitting:  boolean;
  deleting?:   boolean;
  onSubmit:    (form: MessageFormState) => void;
  onDelete?:   () => void;
}

// ── スタイル定数 ──────────────────────────────────────────

const sectionHeader = {
  fontWeight: 600,
  fontSize: 13,
  color: "#374151",
  marginBottom: 12,
  paddingBottom: 6,
  borderBottom: "1px solid #e5e5e5",
} as const;

const fieldLabel = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "#374151",
  marginBottom: 4,
} as const;

const hintText = {
  fontSize: 11,
  color: "#9ca3af",
  marginTop: 3,
} as const;

// ────────────────────────────────────────────────────────
// クイックリプライ — 定数
// ────────────────────────────────────────────────────────

const QR_ACTION_OPTIONS: { value: QuickReplyAction; label: string; icon: string; hint: string; valuePlaceholder?: string; valueLabel?: string; }[] = [
  {
    value: "text",
    label: "テキスト送信",
    icon: "💬",
    hint: "タップすると指定テキストをユーザーが送信します",
    valueLabel: "送信するテキスト",
    valuePlaceholder: "省略時はラベルを送信",
  },
  {
    value: "url",
    label: "URL を開く",
    icon: "🔗",
    hint: "タップすると外部 URL をブラウザで開きます",
    valueLabel: "URL",
    valuePlaceholder: "https://example.com",
  },
  {
    value: "next",
    label: "次へ進む",
    icon: "➡️",
    hint: "タップすると次のフェーズやメッセージへ進みます",
    valueLabel: "トリガーキーワード（任意）",
    valuePlaceholder: "省略時はシステムデフォルト",
  },
  {
    value: "hint",
    label: "ヒント",
    icon: "💡",
    hint: "タップするとヒント本文をボットが返信します",
    valueLabel: "ヒントキー",
    valuePlaceholder: "例: hint1（省略可）",
  },
  {
    value: "custom",
    label: "カスタム",
    icon: "⚙️",
    hint: "タップ時に任意のポストバックデータを送信します",
    valueLabel: "カスタムデータ",
    valuePlaceholder: "任意の文字列",
  },
];

/** 空のクイックリプライ雛形 */
const EMPTY_QR: QuickReplyItem = { label: "", action: "text", value: "" };

/** ヒントボタンのテンプレートプリセット（丸数字） */
const HINT_TEMPLATES = [
  { label: "ヒント①", value: "hint1" },
  { label: "ヒント②", value: "hint2" },
  { label: "ヒント③", value: "hint3" },
] as const;

// ────────────────────────────────────────────────────────
// ヒントプレビューコンポーネント
// ────────────────────────────────────────────────────────

function QrHintPreview({ hintText, hintFollowup }: { hintText?: string; hintFollowup?: string }) {
  if (!hintText?.trim() && !hintFollowup?.trim()) return null;
  const bubble: React.CSSProperties = {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: "0 10px 10px 10px",
    padding: "8px 10px",
    fontSize: 12,
    lineHeight: 1.5,
    color: "#374151",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxWidth: 220,
  };
  return (
    <div style={{
      background: "#f0fdf4",
      border: "1px solid #bbf7d0",
      borderRadius: 8,
      padding: "10px 12px",
      marginTop: 8,
    }}>
      <div style={{ fontSize: 10, color: "#16a34a", fontWeight: 700, marginBottom: 7, letterSpacing: 0.5 }}>
        💬 ユーザーへの返信プレビュー
      </div>
      {hintText?.trim() && <div style={bubble}>{hintText}</div>}
      {hintFollowup?.trim() && (
        <>
          <div style={{ textAlign: "center", color: "#9ca3af", fontSize: 10, margin: "5px 0" }}>▼</div>
          <div style={bubble}>{hintFollowup}</div>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────
// QuickReplyEditor コンポーネント
// ────────────────────────────────────────────────────────

interface QuickReplyEditorProps {
  items:    QuickReplyItem[];
  onChange: (items: QuickReplyItem[]) => void;
  /** target_message_id ピッカー用 — 同じ作品の全メッセージ一覧 */
  messages?: { id: string; body: string | null; kind: string; sort_order: number }[];
  /** target_phase_id ピッカー用 — 同じ作品の全フェーズ一覧 */
  phases?: { id: string; name: string; phase_type: string }[];
}

function QuickReplyEditor({ items, onChange, messages = [], phases = [] }: QuickReplyEditorProps) {
  const [open, setOpen]               = useState(false);
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set());
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const dragSrcRef                    = useRef<number | null>(null);

  // 自動展開: 既存データがある場合は初期表示で開く
  useEffect(() => {
    if (items.length > 0) setOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addItem() {
    if (items.length >= 13) return;
    const newIdx = items.length;
    onChange([...items, { ...EMPTY_QR }]);
    setExpandedSet((prev) => new Set([...prev, newIdx]));
    setOpen(true);
  }

  function updateItem(index: number, patch: Partial<QuickReplyItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
    setExpandedSet((prev) => {
      const next = new Set<number>();
      prev.forEach((n) => {
        if (n < index) next.add(n);
        else if (n > index) next.add(n - 1);
      });
      return next;
    });
  }

  function toggleExpand(index: number) {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  // ── ドラッグ & ドロップ ──
  function handleDragStart(e: React.DragEvent, index: number) {
    dragSrcRef.current = index;
    e.dataTransfer.effectAllowed = "move";
  }
  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(index);
  }
  function handleDrop(e: React.DragEvent, dropIdx: number) {
    e.preventDefault();
    const srcIdx = dragSrcRef.current;
    if (srcIdx === null || srcIdx === dropIdx) {
      setDragOverIdx(null);
      return;
    }
    const next = [...items];
    const [moved] = next.splice(srcIdx, 1);
    next.splice(dropIdx, 0, moved);
    onChange(next);
    // expandedSet のインデックスを更新
    setExpandedSet((prev) => {
      const updated = new Set<number>();
      prev.forEach((n) => {
        if (n === srcIdx) {
          updated.add(dropIdx);
        } else if (srcIdx < dropIdx && n > srcIdx && n <= dropIdx) {
          updated.add(n - 1);
        } else if (srcIdx > dropIdx && n < srcIdx && n >= dropIdx) {
          updated.add(n + 1);
        } else {
          updated.add(n);
        }
      });
      return updated;
    });
    dragSrcRef.current = null;
    setDragOverIdx(null);
  }
  function handleDragEnd() {
    dragSrcRef.current = null;
    setDragOverIdx(null);
  }

  // アクション別バッジ色マップ
  const actionBadge: Record<QuickReplyAction, { bg: string; color: string }> = {
    text:   { bg: "#dcfce7", color: "#15803d" },
    url:    { bg: "#dbeafe", color: "#1d4ed8" },
    next:   { bg: "#ede9fe", color: "#7c3aed" },
    hint:   { bg: "#fef9c3", color: "#92400e" },
    custom: { bg: "#f1f5f9", color: "#475569" },
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    cursor: "pointer",
    userSelect: "none",
  };

  const enabledCount = items.filter((i) => i.enabled !== false).length;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {/* アコーディオンヘッダー */}
      <div style={headerStyle} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...sectionHeader, marginBottom: 0, paddingBottom: 0, borderBottom: "none" }}>
            クイックリプライ設定
          </span>
          <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400 }}>（任意）</span>
          {items.length > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, background: "#06C755", color: "#fff",
              borderRadius: 10, padding: "1px 7px",
            }}>
              {enabledCount}/{items.length}件
            </span>
          )}
        </div>
        <span style={{ fontSize: 16, color: "#9ca3af", lineHeight: 1 }}>
          {open ? "▲" : "▼"}
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ ...hintText, marginBottom: 14 }}>
            メッセージの下に表示される選択肢ボタンです。LINE 仕様: 最大13件 / ラベル最大20文字。⠿ をドラッグして並び替え可能。
          </p>

          {/* アイテム一覧 */}
          {items.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {items.map((item, index) => {
                const isExpanded = expandedSet.has(index);
                const isEnabled  = item.enabled !== false;
                const isDragOver = dragOverIdx === index;
                const actionDef  = QR_ACTION_OPTIONS.find((o) => o.value === item.action);
                const badge      = actionBadge[item.action];

                return (
                  <div
                    key={index}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e)  => handleDragOver(e, index)}
                    onDrop={(e)      => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    style={{
                      border:     isDragOver ? "2px dashed #06C755" : "1px solid #e5e7eb",
                      borderRadius: 8,
                      background: isEnabled ? "#fafafa" : "#f1f5f9",
                      opacity:    isEnabled ? 1 : 0.6,
                      transition: "border 0.1s, opacity 0.15s",
                    }}
                  >
                    {/* ── カード折り畳みヘッダー ── */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 7,
                      padding: "9px 12px",
                    }}>
                      {/* ドラッグハンドル */}
                      <span
                        style={{ color: "#9ca3af", fontSize: 15, cursor: "grab", userSelect: "none", lineHeight: 1 }}
                        title="ドラッグして並び替え"
                      >
                        ⠿
                      </span>

                      {/* 展開トグル領域 */}
                      <div
                        style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0, cursor: "pointer" }}
                        onClick={() => toggleExpand(index)}
                      >
                        {/* アクションバッジ */}
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          background: badge.bg, color: badge.color,
                          borderRadius: 4, padding: "1px 6px",
                          whiteSpace: "nowrap", flexShrink: 0,
                        }}>
                          {actionDef?.icon} {actionDef?.label}
                        </span>
                        {/* ラベルテキスト */}
                        <span style={{
                          fontSize: 13, fontWeight: 500, color: "#374151",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {item.label || (
                            <span style={{ color: "#9ca3af" }}>
                              {item.action === "text" ? "（テキスト未設定）" : "（ラベル未設定）"}
                            </span>
                          )}
                        </span>
                        {/* テキストアクション遷移先インジケーター */}
                        {item.action === "text" && item.target_phase_id && (
                          <span style={{
                            fontSize: 10, fontWeight: 600, flexShrink: 0,
                            color: "#7c3aed", background: "#f5f3ff",
                            border: "1px solid #e9d5ff",
                            borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap",
                          }}>
                            → {phases.find((p) => p.id === item.target_phase_id)?.name ?? "フェーズ"}
                          </span>
                        )}
                        {item.action === "text" && item.target_type === "message" && item.target_message_id && (
                          <span style={{
                            fontSize: 10, fontWeight: 600, flexShrink: 0,
                            color: "#0ea5e9", background: "#f0f9ff",
                            border: "1px solid #bae6fd",
                            borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap",
                          }}>
                            → メッセージ返信
                          </span>
                        )}
                        {/* ヒント設定済みインジケーター */}
                        {item.action === "hint" && item.hint_text && (
                          <span style={{ fontSize: 11, color: "#b45309", flexShrink: 0 }} title="ヒント本文設定済み">💡</span>
                        )}
                        {/* 展開アイコン */}
                        <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: "auto", flexShrink: 0 }}>
                          {isExpanded ? "▲" : "▼"}
                        </span>
                      </div>

                      {/* ON/OFF トグル */}
                      <label
                        onClick={(e) => e.stopPropagation()}
                        style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none", flexShrink: 0 }}
                        title={isEnabled ? "クリックで無効化" : "クリックで有効化"}
                      >
                        <div style={{
                          position: "relative", width: 30, height: 17,
                          background: isEnabled ? "#06C755" : "#d1d5db",
                          borderRadius: 9, transition: "background 0.2s",
                        }}>
                          <div style={{
                            position: "absolute", top: 2,
                            left: isEnabled ? 15 : 2,
                            width: 13, height: 13,
                            borderRadius: "50%", background: "#fff",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                            transition: "left 0.18s",
                            pointerEvents: "none",
                          }} />
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={(e) => updateItem(index, { enabled: e.target.checked ? undefined : false })}
                            style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
                          />
                        </div>
                        <span style={{ fontSize: 10, color: "#6b7280", width: 22 }}>
                          {isEnabled ? "ON" : "OFF"}
                        </span>
                      </label>

                      {/* 削除ボタン */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeItem(index); }}
                        style={{
                          fontSize: 11, padding: "2px 7px",
                          border: "1px solid #fecaca", borderRadius: 5,
                          background: "#fff5f5", color: "#ef4444",
                          cursor: "pointer", flexShrink: 0,
                        }}
                      >
                        削除
                      </button>
                    </div>

                    {/* ── 展開コンテンツ ── */}
                    {isExpanded && (
                      <div style={{ padding: "0 12px 12px", borderTop: "1px solid #e5e7eb" }}>

                        {/* ラベル — テキストアクション以外のみ表示 */}
                        {item.action !== "text" && (
                          <div className="form-group" style={{ marginTop: 10, marginBottom: 8 }}>
                            <label style={{ ...fieldLabel, fontSize: 12 }}>
                              表示ラベル <span style={{ color: "#dc2626" }}>*</span>
                              <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>
                                ({item.label.length}/20)
                              </span>
                            </label>
                            <input
                              type="text"
                              className="form-input"
                              value={item.label}
                              onChange={(e) => updateItem(index, { label: e.target.value })}
                              placeholder="例: 次へ進む"
                              maxLength={20}
                              style={{ fontSize: 13 }}
                            />
                          </div>
                        )}

                        {/* アクション種別 */}
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>アクション種別</label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {QR_ACTION_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => {
                                  if (opt.value === "text") {
                                    // text に切り替え: label を value に同期
                                    updateItem(index, { action: "text", value: item.label || undefined });
                                  } else {
                                    updateItem(index, { action: opt.value, target_phase_id: undefined });
                                  }
                                }}
                                style={{
                                  display: "flex", alignItems: "center", gap: 4,
                                  padding: "5px 10px", borderRadius: 6,
                                  fontSize: 12, fontWeight: 500, cursor: "pointer",
                                  transition: "all 0.12s",
                                  border: item.action === opt.value ? "2px solid #06C755" : "2px solid #e5e7eb",
                                  background: item.action === opt.value ? "#E6F7ED" : "#fff",
                                  color: item.action === opt.value ? "#15803d" : "#6b7280",
                                }}
                              >
                                <span style={{ fontSize: 13 }}>{opt.icon}</span>
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          {actionDef && (
                            <div style={{ ...hintText, marginTop: 5 }}>{actionDef.hint}</div>
                          )}
                        </div>

                        {/* ── アクション別フィールド ── */}
                        {item.action === "hint" ? (
                          <>
                            {/* ヒントキー（テンプレート + 自由入力） */}
                            <div className="form-group" style={{ marginBottom: 8 }}>
                              <label style={{ ...fieldLabel, fontSize: 12 }}>
                                ボタンID
                                <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>（任意）</span>
                              </label>
                              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                {HINT_TEMPLATES.map((t) => {
                                  const isActive = item.value === t.value && item.label === t.label;
                                  return (
                                    <button
                                      key={t.value}
                                      type="button"
                                      onClick={() => updateItem(index, { label: t.label, value: t.value })}
                                      style={{
                                        fontSize: 11, padding: "4px 9px",
                                        border: isActive ? "1.5px solid #f59e0b" : "1.5px solid #e5e7eb",
                                        borderRadius: 6,
                                        background: isActive ? "#fffbeb" : "#f9fafb",
                                        color: isActive ? "#b45309" : "#6b7280",
                                        cursor: "pointer", fontWeight: isActive ? 700 : 400,
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {t.label}
                                    </button>
                                  );
                                })}
                                <input
                                  type="text"
                                  className="form-input"
                                  value={item.value ?? ""}
                                  onChange={(e) => updateItem(index, { value: e.target.value || undefined })}
                                  placeholder="hint1（任意）"
                                  maxLength={500}
                                  style={{ fontSize: 13, flex: 1, minWidth: 80 }}
                                />
                              </div>
                              <div style={{ ...hintText, marginTop: 4 }}>
                                省略するとラベルテキストで照合します。複数ヒントを区別したい場合に設定してください。
                              </div>
                            </div>

                            {/* ヒント本文 */}
                            <div className="form-group" style={{ marginBottom: 8 }}>
                              <label style={{ ...fieldLabel, fontSize: 12 }}>
                                ヒント本文
                                <span style={{ color: "#dc2626", marginLeft: 3 }}>*</span>
                                <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>
                                  ({(item.hint_text ?? "").length}/2000)
                                </span>
                              </label>
                              <textarea
                                className="form-input"
                                value={item.hint_text ?? ""}
                                onChange={(e) => updateItem(index, { hint_text: e.target.value || undefined })}
                                placeholder="ユーザーがこのボタンをタップしたときに返信するヒント本文を入力してください"
                                maxLength={2000}
                                rows={3}
                                style={{ fontSize: 13, resize: "vertical", lineHeight: 1.5 }}
                              />
                            </div>

                            {/* 回答誘導メッセージ（hint_followup） */}
                            <div className="form-group" style={{ marginBottom: 8 }}>
                              <label style={{ ...fieldLabel, fontSize: 12 }}>
                                回答誘導メッセージ
                                <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>（任意）</span>
                                <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>
                                  ({(item.hint_followup ?? "").length}/500)
                                </span>
                              </label>
                              <input
                                type="text"
                                className="form-input"
                                value={item.hint_followup ?? ""}
                                onChange={(e) => updateItem(index, { hint_followup: e.target.value || undefined })}
                                placeholder="例: もう少しヒントが必要なら「ヒント②」を押してね"
                                maxLength={500}
                                style={{ fontSize: 13 }}
                              />
                              <div style={{ ...hintText, marginTop: 4 }}>
                                設定するとヒント本文の直後に続けて送信されます
                              </div>
                            </div>

                            {/* ヒントプレビュー */}
                            <QrHintPreview hintText={item.hint_text} hintFollowup={item.hint_followup} />
                          </>
                        ) : item.action === "url" ? (
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label style={{ ...fieldLabel, fontSize: 12 }}>
                              URL <span style={{ color: "#dc2626" }}>*</span>
                            </label>
                            <input
                              type="url"
                              className="form-input"
                              value={item.value ?? ""}
                              onChange={(e) => updateItem(index, { value: e.target.value || undefined })}
                              placeholder="https://example.com"
                              maxLength={500}
                              style={{ fontSize: 13, fontFamily: "monospace" }}
                            />
                          </div>
                        ) : item.action === "text" ? (
                          <>
                            {/* ── ボタンテキスト（表示文言・送信値・遷移トリガーを兼ねる）── */}
                            <div className="form-group" style={{ marginTop: 10, marginBottom: 10 }}>
                              <label style={{ ...fieldLabel, fontSize: 12 }}>
                                ボタンテキスト <span style={{ color: "#dc2626" }}>*</span>
                                <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>
                                  ({item.label.length}/20)
                                </span>
                              </label>
                              <input
                                type="text"
                                className="form-input"
                                value={item.label}
                                onChange={(e) => {
                                  const t = e.target.value;
                                  updateItem(index, { label: t, value: t || undefined });
                                }}
                                placeholder="例: 話を聞く"
                                maxLength={20}
                                style={{ fontSize: 13 }}
                              />
                              <div style={{ ...hintText, marginTop: 4 }}>
                                ボタンの表示文言・ユーザーが送信するテキスト・遷移トリガーとして共通で使用されます
                              </div>
                            </div>

                            {/* ── タップ時の遷移先 ── */}
                            {(() => {
                              const targetMode = item.target_phase_id
                                ? "phase"
                                : item.target_type === "message"
                                ? "message"
                                : "none";
                              return (
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                  <label style={{ ...fieldLabel, fontSize: 12 }}>タップ時の遷移先</label>
                                  <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                                    {([
                                      { key: "none",    icon: "🔀", label: "自動判定" },
                                      { key: "phase",   icon: "📍", label: "フェーズを指定" },
                                      { key: "message", icon: "💬", label: "メッセージを返信" },
                                    ] as const).map((opt) => (
                                      <button
                                        key={opt.key}
                                        type="button"
                                        onClick={() => {
                                          if (opt.key === "none") {
                                            updateItem(index, { target_type: undefined, target_phase_id: undefined, target_message_id: undefined });
                                          } else if (opt.key === "phase") {
                                            updateItem(index, { target_type: undefined, target_message_id: undefined });
                                          } else {
                                            updateItem(index, { target_type: "message", target_phase_id: undefined });
                                          }
                                        }}
                                        style={{
                                          fontSize: 12, padding: "5px 12px", borderRadius: 6, cursor: "pointer",
                                          border: targetMode === opt.key ? "2px solid #6366f1" : "2px solid #e5e7eb",
                                          background: targetMode === opt.key ? "#eef2ff" : "#fff",
                                          color: targetMode === opt.key ? "#4338ca" : "#6b7280",
                                          fontWeight: targetMode === opt.key ? 700 : 400,
                                        }}
                                      >
                                        {opt.icon} {opt.label}
                                      </button>
                                    ))}
                                  </div>

                                  {targetMode === "none" && (
                                    <div style={{ ...hintText }}>
                                      テキストを遷移条件としてフェーズ設定の遷移と照合します。
                                    </div>
                                  )}

                                  {targetMode === "phase" && (
                                    <>
                                      <label style={{ ...fieldLabel, fontSize: 12 }}>
                                        遷移先フェーズ <span style={{ color: "#dc2626" }}>*</span>
                                      </label>
                                      <select
                                        className="form-input"
                                        value={item.target_phase_id ?? ""}
                                        onChange={(e) => updateItem(index, { target_phase_id: e.target.value || undefined })}
                                        style={{ fontSize: 13 }}
                                      >
                                        <option value="">（フェーズを選択）</option>
                                        {phases.map((p) => (
                                          <option key={p.id} value={p.id}>
                                            {p.name}
                                          </option>
                                        ))}
                                      </select>
                                      <div style={{ ...hintText, marginTop: 4 }}>
                                        タップすると選択したフェーズへ直接遷移します。シナリオフローにも反映されます。
                                      </div>
                                    </>
                                  )}

                                  {targetMode === "message" && (
                                    <>
                                      <label style={{ ...fieldLabel, fontSize: 12 }}>
                                        返信するメッセージ <span style={{ color: "#dc2626" }}>*</span>
                                      </label>
                                      <select
                                        className="form-input"
                                        value={item.target_message_id ?? ""}
                                        onChange={(e) => updateItem(index, { target_message_id: e.target.value || undefined })}
                                        style={{ fontSize: 13 }}
                                      >
                                        <option value="">（メッセージを選択）</option>
                                        {messages.map((m) => (
                                          <option key={m.id} value={m.id}>
                                            [{m.kind}] {m.body ? m.body.slice(0, 40) : `(ID: ${m.id.slice(0, 8)}...)`}
                                          </option>
                                        ))}
                                      </select>
                                      <div style={{ ...hintText, marginTop: 4 }}>
                                        フェーズ遷移せずに選択したメッセージを直接返信します。
                                      </div>
                                    </>
                                  )}
                                </div>
                              );
                            })()}
                          </>
                        ) : (
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label style={{ ...fieldLabel, fontSize: 12 }}>
                              {actionDef?.valueLabel ?? "値"}
                              <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>（任意）</span>
                            </label>
                            <input
                              type="text"
                              className="form-input"
                              value={item.value ?? ""}
                              onChange={(e) => updateItem(index, { value: e.target.value || undefined })}
                              placeholder={actionDef?.valuePlaceholder}
                              maxLength={500}
                              style={{ fontSize: 13 }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 追加ボタン */}
          <button
            type="button"
            onClick={addItem}
            disabled={items.length >= 13}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              border: "1.5px dashed #d1d5db",
              borderRadius: 8,
              background: items.length >= 13 ? "#f9fafb" : "#fff",
              color: items.length >= 13 ? "#9ca3af" : "#374151",
              fontSize: 13,
              fontWeight: 500,
              cursor: items.length >= 13 ? "not-allowed" : "pointer",
              width: "100%",
              justifyContent: "center",
              transition: "all 0.15s",
            }}
          >
            ＋ クイックリプライを追加
            {items.length >= 13 && (
              <span style={{ fontSize: 11, color: "#9ca3af" }}>（上限13件）</span>
            )}
          </button>
        </div>
      )}

      {/* 閉じているときのミニ追加ボタン */}
      {!open && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={addItem}
            style={{
              fontSize: 12, padding: "5px 12px",
              border: "1px dashed #d1d5db", borderRadius: 6,
              background: "#fff", color: "#6b7280", cursor: "pointer",
            }}
          >
            ＋ クイックリプライを追加
          </button>
        </div>
      )}
    </div>
  );
}

// ── LINEプレビューパネル ──────────────────────────────────

interface PreviewPanelProps {
  form:       MessageFormState;
  characters: Character[];
  riddles:    Riddle[];
}

/** クイックリプライボタンの表示色定義 */
const QR_CHIP_COLORS: Record<QuickReplyAction, { bg: string; text: string; border: string }> = {
  text:   { bg: "#f0fdf4", text: "#15803d",  border: "#bbf7d0" },
  url:    { bg: "#eff6ff", text: "#1d4ed8",  border: "#bfdbfe" },
  next:   { bg: "#faf5ff", text: "#7c3aed",  border: "#ddd6fe" },
  hint:   { bg: "#fffbeb", text: "#b45309",  border: "#fde68a" },
  custom: { bg: "#f8fafc", text: "#475569",  border: "#e2e8f0" },
};

function PreviewPanel({ form, characters, riddles }: PreviewPanelProps) {
  const selectedChar   = characters.find((c) => c.id === form.character_id) ?? null;
  const selectedRiddle = riddles.find((r) => r.id === form.riddle_id);

  // ── キャラアイコン ──
  const iconEl = selectedChar ? (
    selectedChar.icon_image_url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={selectedChar.icon_image_url}
        alt={selectedChar.name}
        style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    ) : (
      <div style={{
        width: 36, height: 36, borderRadius: "50%",
        background: selectedChar.icon_color ?? "#06C755",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 700, color: "#fff",
      }}>
        {selectedChar.icon_type === "text"
          ? (selectedChar.icon_text ?? selectedChar.name[0])
          : selectedChar.name[0]}
      </div>
    )
  ) : (
    <div style={{
      width: 36, height: 36, borderRadius: "50%",
      background: "#c9cdd4", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
    }}>📢</div>
  );

  // ── バブル内コンテンツ ──
  const bubbleContent = (() => {
    // puzzle は配信形式（message_type）ごとのコンテンツ + 謎バッジを表示
    if (form.kind === "puzzle") {
      let puzzleContentEl: React.ReactNode;
      switch (form.message_type) {
        case "image":
          puzzleContentEl = form.asset_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.asset_url} alt="謎画像プレビュー"
              style={{ maxWidth: 200, maxHeight: 160, borderRadius: 8, objectFit: "cover", display: "block" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{ width: 160, height: 100, background: "#e5e7eb", borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: "#9ca3af" }}>🖼</div>
          );
          break;
        case "video":
          puzzleContentEl = (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 24 }}>🎬</span>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>動画</div>
                {form.asset_url && <div style={{ fontSize: 10, color: "#9ca3af", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{form.asset_url}</div>}
              </div>
            </div>
          );
          break;
        case "carousel":
          puzzleContentEl = form.carousel_items.length === 0
            ? <span style={{ color: "#aaa", fontStyle: "italic", fontSize: 12 }}>カードを追加してください</span>
            : (
              <div style={{ overflowX: "auto", display: "flex", gap: 8, paddingBottom: 4 }}>
                {form.carousel_items.map((card, idx) => (
                  <div key={idx} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, width: 130, flexShrink: 0, overflow: "hidden" }}>
                    {card.image_url
                      ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={card.image_url} alt="" style={{ width: "100%", height: 70, objectFit: "cover", display: "block" }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      )
                      : <div style={{ width: "100%", height: 50, background: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#9ca3af" }}>🖼</div>
                    }
                    <div style={{ padding: "5px 7px" }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.title || `カード ${idx + 1}`}</div>
                      {card.button_label && <div style={{ marginTop: 4, padding: "2px 6px", background: "#06C755", color: "#fff", borderRadius: 4, fontSize: 9, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.button_label}</div>}
                    </div>
                  </div>
                ))}
              </div>
            );
          break;
        default: // text
          puzzleContentEl = form.body
            ? <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{form.body}</span>
            : <span style={{ color: "#aaa", fontStyle: "italic" }}>謎の本文を入力してください</span>;
      }
      return (
        <div>
          {/* 謎バッジ */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 10, fontWeight: 700, background: "#fff7ed", color: "#c2410c",
              border: "1px solid #fed7aa", padding: "1px 7px", borderRadius: 10,
            }}>
              🧩 謎チャレンジ
            </span>
            {form.puzzle_type && (
              <span style={{ fontSize: 10, color: "#9ca3af" }}>{form.puzzle_type}</span>
            )}
          </div>
          {/* コンテンツ */}
          {puzzleContentEl}
          {/* 答え（管理用ヒント） */}
          {form.answer && (
            <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 5 }}>
              答え: <span style={{ fontWeight: 600, color: "#6b7280" }}>{form.answer}</span>
            </div>
          )}
        </div>
      );
    }
    switch (form.message_type) {
      case "text": {
        if (!form.body) {
          return <span style={{ color: "#aaa", fontStyle: "italic" }}>テキストを入力してください</span>;
        }
        const PLACEHOLDER_MAP: Record<string, string> = {
          "{{user_name}}":    "友だちの表示名",
          "{{account_name}}": "アカウント名",
        };
        const parts = form.body.split(/({{user_name}}|{{account_name}})/g);
        return (
          <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {parts.map((part, i) =>
              PLACEHOLDER_MAP[part] ? (
                <span key={i} style={{
                  display: "inline-block", fontSize: 11, fontWeight: 700,
                  padding: "1px 7px", borderRadius: 12, margin: "0 1px",
                  background: "#E6F7ED", color: "#059669", border: "1px solid #06C755",
                }}>
                  {PLACEHOLDER_MAP[part]}
                </span>
              ) : part
            )}
          </span>
        );
      }
      case "image":
        return form.asset_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={form.asset_url} alt="画像プレビュー"
            style={{ maxWidth: 200, maxHeight: 160, borderRadius: 8, objectFit: "cover", display: "block" }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div style={{ width: 160, height: 100, background: "#e5e7eb", borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: "#9ca3af" }}>🖼</div>
        );
      case "riddle":
        return (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <span style={{ fontSize: 20 }}>🔍</span>
            <div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>謎チャレンジ</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>
                {selectedRiddle
                  ? selectedRiddle.title
                  : <span style={{ color: "#aaa", fontStyle: "italic" }}>謎を選択してください</span>}
              </div>
            </div>
          </div>
        );
      case "video":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 24 }}>🎬</span>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>動画</div>
              {form.asset_url && <div style={{ fontSize: 10, color: "#9ca3af", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{form.asset_url}</div>}
            </div>
          </div>
        );
      case "voice":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 22 }}>🎙</span>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>ボイスメッセージ</div>
              {form.asset_url && <div style={{ fontSize: 10, color: "#9ca3af", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{form.asset_url}</div>}
            </div>
          </div>
        );
      case "carousel":
        return form.carousel_items.length === 0
          ? <span style={{ color: "#aaa", fontStyle: "italic", fontSize: 12 }}>カードを追加してください</span>
          : (
            <div style={{ overflowX: "auto", display: "flex", gap: 8, paddingBottom: 4 }}>
              {form.carousel_items.map((card, idx) => (
                <div key={idx} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, width: 130, flexShrink: 0, overflow: "hidden" }}>
                  {card.image_url
                    ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.image_url} alt="" style={{ width: "100%", height: 70, objectFit: "cover", display: "block" }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    )
                    : <div style={{ width: "100%", height: 50, background: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#9ca3af" }}>🖼</div>
                  }
                  <div style={{ padding: "5px 7px" }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.title || `カード ${idx + 1}`}</div>
                    {card.button_label && <div style={{ marginTop: 4, padding: "2px 6px", background: "#06C755", color: "#fff", borderRadius: 4, fontSize: 9, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.button_label}</div>}
                  </div>
                </div>
              ))}
            </div>
          );
    }
  })();

  return (
    <div style={{
      border: "1px solid #d1d5db", borderRadius: 14,
      overflow: "hidden",
      boxShadow: "0 4px 20px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)",
      background: "#fff",
    }}>
      {/* トークヘッダー（プレイグラウンドと同一デザイン） */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #e9ecef",
        padding: "10px 16px", display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 20, color: "#9ca3af", lineHeight: 1, marginTop: -1 }}>‹</span>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "#111827" }}>
            {selectedChar ? selectedChar.name : "（キャラ未選択）"}
          </div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#06C755", background: "#E6F7ED",
          padding: "2px 7px", borderRadius: 8, border: "1px solid #06C75533" }}>
          LINE
        </span>
      </div>

      {/* チャットエリア */}
      <div style={{ background: "#c4dde3", padding: "14px 12px 18px", minHeight: 280 }}>
        {/* notify_text（テキスト以外） */}
        {form.message_type !== "text" && form.notify_text && (
          <div style={{ textAlign: "center", marginBottom: 10, fontSize: 11, color: "rgba(0,0,0,0.4)",
            background: "rgba(255,255,255,0.45)", borderRadius: 10, padding: "3px 12px",
            display: "inline-block", marginLeft: "50%", transform: "translateX(-50%)" }}>
            {form.notify_text}
          </div>
        )}

        {/* キャラ + 吹き出し */}
        <div style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
          <div style={{ flexShrink: 0 }}>{iconEl}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {selectedChar && (
              <p style={{ fontSize: 11, color: "rgba(0,0,0,0.5)", marginBottom: 4, fontWeight: 400 }}>
                {selectedChar.name}
              </p>
            )}
            {/* 吹き出し（しっぽ付き） */}
            <div style={{ position: "relative", display: "inline-block", maxWidth: 220 }}>
              <div style={{
                position: "absolute", left: -6, top: 10,
                width: 0, height: 0, borderStyle: "solid",
                borderWidth: "5px 7px 5px 0",
                borderColor: "transparent #fff transparent transparent",
              }} />
              <div style={{
                background: "#fff", borderRadius: "4px 16px 16px 16px",
                padding: "8px 12px", fontSize: 14, color: "#111",
                lineHeight: 1.55, wordBreak: "break-word",
                boxShadow: "0 0.5px 1.5px rgba(0,0,0,0.1)",
              }}>
                {bubbleContent}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* クイックリプライエリア（設定されている場合のみ表示） */}
      {form.quick_replies.length > 0 && (
        <div style={{
          background: "#fff",
          borderTop: "1px solid #e9ecef",
          padding: "8px 10px",
        }}>
          <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 5, fontWeight: 600 }}>
            クイックリプライ
          </div>
          <div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 5,
          }}>
            {form.quick_replies.map((qr, i) => {
              const chipColor = QR_CHIP_COLORS[qr.action];
              const actionDef = QR_ACTION_OPTIONS.find((o) => o.value === qr.action);
              return (
                <span
                  key={i}
                  title={`${actionDef?.label}${qr.value ? ` → ${qr.value}` : ""}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    padding: "4px 10px",
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 600,
                    background: chipColor.bg,
                    color: chipColor.text,
                    border: `1px solid ${chipColor.border}`,
                    maxWidth: 120,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    cursor: "default",
                  }}
                >
                  <span style={{ fontSize: 12 }}>{actionDef?.icon}</span>
                  {qr.label || <span style={{ fontStyle: "italic", opacity: 0.6 }}>ラベル未入力</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── メインコンポーネント ────────────────────────────────────

export function MessageForm({
  oaId, workId, workTitle, initialForm, isNew,
  submitting, deleting, onSubmit, onDelete,
}: MessageFormProps) {
  const [form, setForm]       = useState<MessageFormState>(initialForm);
  const [error, setError]     = useState<string | null>(null);
  const bodyTextareaRef       = useRef<HTMLTextAreaElement>(null);

  const isPuzzle = form.kind === "puzzle";

  const [phases, setPhases]         = useState<PhaseWithCounts[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [riddles, setRiddles]       = useState<Riddle[]>([]);
  const [allMessages, setAllMessages] = useState<{ id: string; body: string | null; kind: string; sort_order: number }[]>([]);

  useEffect(() => {
    const token = getDevToken();
    Promise.all([
      phaseApi.list(token, workId),
      characterApi.list(token, workId),
      riddleApi.list(token, oaId),
      messageApi.list(token, workId),
    ]).then(([ph, ch, rd, msgs]) => {
      setPhases(ph);
      setCharacters(ch);
      setRiddles(rd);
      setAllMessages(msgs.map((m) => ({
        id: m.id,
        body: m.body,
        kind: m.kind,
        sort_order: m.sort_order,
      })));
    }).catch(() => {});
  }, [workId, oaId]);

  function set<K extends keyof MessageFormState>(k: K, v: MessageFormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function insertAtCursor(placeholder: string) {
    const el = bodyTextareaRef.current;
    if (!el) {
      set("body", form.body + placeholder);
      return;
    }
    const start = el.selectionStart ?? form.body.length;
    const end   = el.selectionEnd   ?? form.body.length;
    const next  = form.body.slice(0, start) + placeholder + form.body.slice(end);
    set("body", next);
    // Restore cursor after React re-render
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  }

  // ── カルーセルカード操作 ────────────────────────────────

  function addCard() {
    if (form.carousel_items.length >= 10) return;
    set("carousel_items", [...form.carousel_items, { ...EMPTY_CAROUSEL_CARD }]);
  }

  function updateCard(index: number, key: keyof MessageCarouselCard, value: string) {
    const updated = form.carousel_items.map((c, i) =>
      i === index ? { ...c, [key]: value } : c
    );
    set("carousel_items", updated);
  }

  function removeCard(index: number) {
    set("carousel_items", form.carousel_items.filter((_, i) => i !== index));
  }

  // ── 送信 ────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateMessageForm(form);
    if (err) { setError(err); return; }
    setError(null);
    onSubmit(form);
  }

  // ── answer_match_type トグル ────────────────────────────
  function toggleMatchType(mt: AnswerMatchType) {
    const current = form.answer_match_type;
    if (current.includes(mt)) {
      // 最低1つは残す
      if (current.length <= 1) return;
      set("answer_match_type", current.filter((x) => x !== mt));
    } else {
      set("answer_match_type", [...current, mt]);
    }
  }

  // ── レンダリング ──────────────────────────────────────────

  const mtype = form.message_type;

  return (
    <>
      {/* ── レスポンシブ: 768px以下で縦並び ── */}
      <style>{`
        .msg-form-layout { display: flex; gap: 24px; align-items: flex-start; }
        .msg-form-col    { flex: 1; min-width: 0; }
        .msg-preview-col {
          flex-shrink: 0; width: 340px;
          position: sticky; top: 24px;
          max-height: calc(100vh - 48px);
          overflow-y: auto;
        }
        @media (max-width: 768px) {
          .msg-form-layout  { flex-direction: column; }
          .msg-preview-col  { position: static; width: 100%; max-height: none; order: -1; }
        }
      `}</style>

      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            ...(workTitle ? [{ label: workTitle, href: `/oas/${oaId}/works/${workId}` }] : []),
            { label: "メッセージ・謎", href: `/oas/${oaId}/works/${workId}/messages` },
            { label: isNew ? "新規作成" : "編集" },
          ]} />
          <h2>{isNew ? "メッセージを追加" : "メッセージを編集"}</h2>
        </div>
      </div>

      {/* ── 2カラムレイアウト ── */}
      <div className="msg-form-layout">
        {/* ── 左カラム: フォーム ── */}
        <form
          onSubmit={handleSubmit}
          className="msg-form-col"
        >
          {/* エラーアラート */}
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* ════════════════════════════════════════
              カテゴリ選択: メッセージ / 謎
          ════════════════════════════════════════ */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={sectionHeader}>送るものの種類</div>
            <div style={{ display: "flex", gap: 12 }}>
              {([
                { value: "normal" as const, icon: "💬", label: "メッセージを送る",  desc: "テキストや画像など、通常の会話メッセージ" },
                { value: "puzzle" as const, icon: "🧩", label: "謎・問題を出す", desc: "回答やヒントを含むインタラクティブなコンテンツ" },
              ] as const).map((cat) => {
                const isActive = cat.value === "puzzle" ? isPuzzle : !isPuzzle;
                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => {
                      if (cat.value === "puzzle" && !isPuzzle) {
                        set("kind", "puzzle");
                      } else if (cat.value === "normal" && isPuzzle) {
                        set("kind", "normal");
                      }
                    }}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: "16px 12px",
                      borderRadius: 10,
                      cursor: "pointer",
                      border: isActive ? "2px solid #06C755" : "2px solid #e5e7eb",
                      background: isActive ? "#E6F7ED" : "#fff",
                      transition: "all 0.15s",
                    }}
                  >
                    <span style={{ fontSize: 28 }}>{cat.icon}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: isActive ? "#06C755" : "#374151" }}>
                      {cat.label}
                    </span>
                    <span style={{ fontSize: 11, color: isActive ? "#059669" : "#6b7280", textAlign: "center" }}>
                      {cat.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ════════════════════════════════════════
              セクション 1: トリガー設定
          ════════════════════════════════════════ */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={sectionHeader}>トリガー設定</div>

            {/* メッセージ役割 (puzzle 以外) */}
            {!isPuzzle && (
            <div className="form-group">
              <label style={fieldLabel} htmlFor="msg_kind">
                メッセージ役割
              </label>
              <select
                id="msg_kind"
                className="form-input"
                value={form.kind}
                onChange={(e) => set("kind", e.target.value as MessageKind)}
              >
                <option value="normal">通常（フェーズ遷移時に送信）</option>
                <option value="start">開始演出（startTrigger 一致時に送信）</option>
                <option value="response">応答（trigger_keyword 一致時に返信）</option>
                <option value="hint">ヒント（将来拡張）</option>
                <option value="global">💬 共通メッセージ（フェーズ不問・常時反応）</option>
              </select>
              <div style={hintText}>
                {form.kind === "start"    && "開始フェーズの startTrigger が一致したとき送信されます。フェーズに kind=start のメッセージがない場合は通常メッセージにフォールバックします。"}
                {form.kind === "response" && "trigger_keyword が一致したときのみ返信します。フェーズは進みません。"}
                {form.kind === "normal"   && "フェーズ遷移時またはフェーズ表示時に送信されます。"}
                {form.kind === "hint"     && "ヒント用メッセージです（将来拡張）。"}
                {form.kind === "global"   && "どのフェーズにいても反応します。ヒント・ヘルプ・やり直し案内などに使います。キーワードは必須です。フェーズ設定は無視されます。"}
              </div>
              {form.kind === "global" && (
                <div style={{
                  marginTop: 8,
                  padding: "8px 12px",
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 6,
                  fontSize: 11,
                  color: "#166534",
                  lineHeight: 1.6,
                }}>
                  💡 <strong>共通メッセージ</strong>：フェーズに依存しない返信です。
                  「応答キーワード」を必ず設定してください。フェーズ設定は自動的に無視されます。
                </div>
              )}
            </div>
            )}

            {/* 応答キーワード（puzzle は不要） */}
            {!isPuzzle && (
            <div className="form-group">
              <label style={fieldLabel} htmlFor="trigger_keyword">
                応答キーワード
                {form.kind === "start" && <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 6 }}>（kind=start では使用しません）</span>}
              </label>
              <input
                id="trigger_keyword"
                type="text"
                className="form-input"
                value={form.trigger_keyword}
                onChange={(e) => set("trigger_keyword", e.target.value)}
                placeholder={form.kind === "global" ? "例: ヒント、ヘルプ、やり直し" : "例: スタート"}
                maxLength={100}
                disabled={form.kind === "start"}
                style={form.kind === "start" ? { opacity: 0.5 } : undefined}
              />
              <div style={hintText}>
                {form.kind === "start"  && "kind=start では Phase.startTrigger を使います"}
                {form.kind === "global" && "⚠️ 共通メッセージではキーワードが必須です。このキーワードにどのフェーズでも反応します。"}
                {form.kind !== "start" && form.kind !== "global" && "このキーワードを受信したとき送信します（kind=response 推奨）"}
              </div>
            </div>
            )}

            {/* 送信対象セグメント */}
            <div className="form-group">
              <label style={fieldLabel} htmlFor="target_segment">
                送信対象セグメント
              </label>
              <select
                id="target_segment"
                className="form-input"
                value={form.target_segment}
                onChange={(e) => set("target_segment", e.target.value)}
              >
                <option value="">すべて</option>
                <option value="not_started">未開始</option>
                <option value="in_progress">進行中</option>
                <option value="completed">クリア済み</option>
              </select>
            </div>

            {/* フェーズ（共通メッセージ時は非表示） */}
            {form.kind !== "global" && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={fieldLabel} htmlFor="phase_id">
                フェーズ
              </label>
              <select
                id="phase_id"
                className="form-input"
                value={form.phase_id}
                onChange={(e) => set("phase_id", e.target.value)}
              >
                <option value="">— フェーズを指定しない —</option>
                {phases.map((ph) => (
                  <option key={ph.id} value={ph.id}>
                    {ph.name}
                  </option>
                ))}
              </select>
              <div style={hintText}>フェーズ未指定の場合、全フェーズで適用されます</div>
            </div>
            )}
          </div>

          {/* ════════════════════════════════════════
              セクション 2: 送信設定
          ════════════════════════════════════════ */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={sectionHeader}>送信設定</div>

            {/* 応答キャラクター */}
            <div className="form-group">
              <label style={fieldLabel} htmlFor="character_id">
                応答キャラクター
              </label>
              <select
                id="character_id"
                className="form-input"
                value={form.character_id}
                onChange={(e) => set("character_id", e.target.value)}
              >
                <option value="">— キャラクターを指定しない —</option>
                {characters.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 表示順序 */}
            <div className="form-group">
              <label style={fieldLabel} htmlFor="sort_order">
                表示順序
              </label>
              <input
                id="sort_order"
                type="number"
                className="form-input"
                style={{ maxWidth: 120 }}
                value={form.sort_order}
                onChange={(e) => set("sort_order", Number(e.target.value))}
                min={0}
              />
            </div>

            {/* 有効フラグ */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => set("is_active", e.target.checked)}
                />
                <span style={{ fontSize: 14 }}>有効にする</span>
              </label>
              <div style={hintText}>無効にすると Bot はこのメッセージを送信しません</div>
            </div>
          </div>

          {/* ════════════════════════════════════════
              セクション 3a: 謎の形式とコンテンツ（puzzle のみ）
          ════════════════════════════════════════ */}
          {isPuzzle && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={sectionHeader}>🧩 謎の形式</div>

            {/* ── 形式選択 ── */}
            <div className="form-group">
              <label style={fieldLabel}>形式</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {PUZZLE_DELIVERY_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set("message_type", opt.value as ExtendedMessageType)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 3,
                      padding: "10px 14px",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 500,
                      transition: "all 0.15s",
                      minWidth: 72,
                      border: mtype === opt.value ? "2px solid #06C755" : "2px solid #e5e5e5",
                      background: mtype === opt.value ? "#E6F7ED" : "#fff",
                      color: mtype === opt.value ? "#06C755" : "#6b7280",
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── テキスト ── */}
            {mtype === "text" && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={fieldLabel} htmlFor="puzzle_body">
                  本文 <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <textarea
                  id="puzzle_body"
                  className="form-input"
                  style={{ minHeight: 100, resize: "vertical" }}
                  value={form.body}
                  onChange={(e) => set("body", e.target.value)}
                  placeholder="謎の問題文を入力してください"
                  maxLength={5000}
                />
                <div style={{ ...hintText, textAlign: "right" }}>
                  {form.body.length} / 5000
                </div>
              </div>
            )}

            {/* ── 画像 ── */}
            {mtype === "image" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel} htmlFor="puzzle_asset_url_image">
                    画像 URL <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    id="puzzle_asset_url_image"
                    type="url"
                    className="form-input"
                    value={form.asset_url}
                    onChange={(e) => set("asset_url", e.target.value)}
                    placeholder="https://example.com/puzzle.png"
                    style={{ fontFamily: "monospace", fontSize: 13 }}
                  />
                  {form.asset_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.asset_url}
                      alt="プレビュー"
                      style={{ marginTop: 8, maxWidth: 240, maxHeight: 140, objectFit: "contain", borderRadius: 6, border: "1px solid #e5e5e5", display: "block" }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="puzzle_notify_image">通知メッセージ（任意）</label>
                  <input id="puzzle_notify_image" type="text" className="form-input" value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)} placeholder="例: 謎が届きました" maxLength={200} />
                </div>
              </>
            )}

            {/* ── 動画 ── */}
            {mtype === "video" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel} htmlFor="puzzle_asset_url_video">
                    動画 URL <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    id="puzzle_asset_url_video"
                    type="url"
                    className="form-input"
                    value={form.asset_url}
                    onChange={(e) => set("asset_url", e.target.value)}
                    placeholder="https://example.com/puzzle.mp4"
                    style={{ fontFamily: "monospace", fontSize: 13 }}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="puzzle_notify_video">通知メッセージ（任意）</label>
                  <input id="puzzle_notify_video" type="text" className="form-input" value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)} placeholder="例: 謎が届きました" maxLength={200} />
                </div>
              </>
            )}

            {/* ── カルーセル ── */}
            {mtype === "carousel" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel}>
                    カード <span style={{ color: "#dc2626" }}>*</span>
                    <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>
                      ({form.carousel_items.length} / 10枚)
                    </span>
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
                    {form.carousel_items.map((card, index) => (
                      <div key={index} style={{ padding: "14px 16px", border: "1px solid #e5e5e5", borderRadius: 8, background: "#fafafa" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>カード {index + 1}</span>
                          <button type="button" className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 11, color: "#ef4444", borderColor: "#fecaca" }} onClick={() => removeCard(index)}>削除</button>
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>タイトル</label>
                          <input type="text" className="form-input" value={card.title} onChange={(e) => updateCard(index, "title", e.target.value)} placeholder="カードのタイトル" maxLength={100} style={{ fontSize: 13 }} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>本文（任意）</label>
                          <textarea className="form-input" value={card.body} onChange={(e) => updateCard(index, "body", e.target.value)} placeholder="カードの説明文" maxLength={500} rows={2} style={{ fontSize: 13, resize: "vertical" }} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>画像 URL（任意）</label>
                          <input type="url" className="form-input" value={card.image_url} onChange={(e) => updateCard(index, "image_url", e.target.value)} placeholder="https://example.com/image.png" style={{ fontFamily: "monospace", fontSize: 12 }} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>ボタンラベル（任意）</label>
                          <input type="text" className="form-input" value={card.button_label} onChange={(e) => updateCard(index, "button_label", e.target.value)} placeholder="例: 詳しく見る" maxLength={50} style={{ fontSize: 13 }} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>ボタン URL（任意）</label>
                          <input type="url" className="form-input" value={card.button_url} onChange={(e) => updateCard(index, "button_url", e.target.value)} placeholder="https://example.com/" style={{ fontFamily: "monospace", fontSize: 12 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {form.carousel_items.length < 10 && (
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 13, padding: "6px 14px" }} onClick={addCard}>
                      ＋ カードを追加
                    </button>
                  )}
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="puzzle_notify_carousel">通知メッセージ（任意）</label>
                  <input id="puzzle_notify_carousel" type="text" className="form-input" value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)} placeholder="例: 謎が届きました" maxLength={200} />
                </div>
              </>
            )}
          </div>
          )} {/* /isPuzzle section 3a (形式+コンテンツ) */}

          {/* ════════════════════════════════════════
              セクション 3b: 1通目のメッセージ（puzzle のときは非表示）
          ════════════════════════════════════════ */}
          {!isPuzzle && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={sectionHeader}>1通目のメッセージ</div>

            {/* 種別選択 */}
            <div className="form-group">
              <label style={fieldLabel}>種別</label>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                {MESSAGE_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set("message_type", opt.value)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 3,
                      padding: "10px 14px",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 500,
                      transition: "all 0.15s",
                      minWidth: 72,
                      border: mtype === opt.value
                        ? "2px solid #06C755"
                        : "2px solid #e5e5e5",
                      background: mtype === opt.value ? "#E6F7ED" : "#fff",
                      color: mtype === opt.value ? "#06C755" : "#6b7280",
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── テキスト ── */}
            {mtype === "text" && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={fieldLabel} htmlFor="body">
                  本文 <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <textarea
                  ref={bodyTextareaRef}
                  id="body"
                  className="form-input"
                  style={{ minHeight: 100, resize: "vertical" }}
                  value={form.body}
                  onChange={(e) => set("body", e.target.value)}
                  placeholder="送信するテキストを入力してください"
                  maxLength={5000}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[
                      { label: "友だちの表示名", placeholder: "{{user_name}}" },
                      { label: "アカウント名",   placeholder: "{{account_name}}" },
                    ].map(({ label, placeholder }) => (
                      <button
                        key={placeholder}
                        type="button"
                        onClick={() => insertAtCursor(placeholder)}
                        style={{
                          fontSize: 12, padding: "2px 10px", borderRadius: 20,
                          border: "1px solid #06C755", background: "#E6F7ED",
                          color: "#059669", cursor: "pointer", fontWeight: 500,
                        }}
                      >
                        + {label}
                      </button>
                    ))}
                  </div>
                  <div style={{ ...hintText }}>{form.body.length} / 5000</div>
                </div>
              </div>
            )}

            {/* ── 画像 ── */}
            {mtype === "image" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel} htmlFor="asset_url_image">
                    画像 URL <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    id="asset_url_image"
                    type="url"
                    className="form-input"
                    value={form.asset_url}
                    onChange={(e) => set("asset_url", e.target.value)}
                    placeholder="https://example.com/image.png"
                    style={{ fontFamily: "monospace", fontSize: 13 }}
                  />
                  {form.asset_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.asset_url}
                      alt="プレビュー"
                      style={{
                        marginTop: 8,
                        maxWidth: 240,
                        maxHeight: 140,
                        objectFit: "contain",
                        borderRadius: 6,
                        border: "1px solid #e5e5e5",
                        display: "block",
                      }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="notify_text_image">
                    通知メッセージ（任意）
                  </label>
                  <input
                    id="notify_text_image"
                    type="text"
                    className="form-input"
                    value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)}
                    placeholder="例: 画像が届きました"
                    maxLength={200}
                  />
                </div>
              </>
            )}

            {/* ── 謎 ── */}
            {mtype === "riddle" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel} htmlFor="riddle_id">
                    謎 <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <select
                    id="riddle_id"
                    className="form-input"
                    value={form.riddle_id}
                    onChange={(e) => set("riddle_id", e.target.value)}
                  >
                    <option value="">— 謎を選択してください —</option>
                    {riddles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="notify_text_riddle">
                    通知メッセージ（任意）
                  </label>
                  <input
                    id="notify_text_riddle"
                    type="text"
                    className="form-input"
                    value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)}
                    placeholder="例: 謎が届きました"
                    maxLength={200}
                  />
                </div>
              </>
            )}

            {/* ── 動画 ── */}
            {mtype === "video" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel} htmlFor="asset_url_video">
                    動画 URL <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    id="asset_url_video"
                    type="url"
                    className="form-input"
                    value={form.asset_url}
                    onChange={(e) => set("asset_url", e.target.value)}
                    placeholder="https://example.com/video.mp4"
                    style={{ fontFamily: "monospace", fontSize: 13 }}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="notify_text_video">
                    通知メッセージ（任意）
                  </label>
                  <input
                    id="notify_text_video"
                    type="text"
                    className="form-input"
                    value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)}
                    placeholder="例: 動画が届きました"
                    maxLength={200}
                  />
                </div>
              </>
            )}

            {/* ── カルーセル ── */}
            {mtype === "carousel" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel}>
                    カード <span style={{ color: "#dc2626" }}>*</span>
                    <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>
                      ({form.carousel_items.length} / 10枚)
                    </span>
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
                    {form.carousel_items.map((card, index) => (
                      <div
                        key={index}
                        style={{
                          padding: "14px 16px",
                          border: "1px solid #e5e5e5",
                          borderRadius: 8,
                          background: "#fafafa",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: 10,
                          }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                            カード {index + 1}
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{
                              padding: "2px 8px",
                              fontSize: 11,
                              color: "#ef4444",
                              borderColor: "#fecaca",
                            }}
                            onClick={() => removeCard(index)}
                          >
                            削除
                          </button>
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>
                            タイトル
                          </label>
                          <input
                            type="text"
                            className="form-input"
                            value={card.title}
                            onChange={(e) => updateCard(index, "title", e.target.value)}
                            placeholder="カードのタイトル"
                            maxLength={100}
                            style={{ fontSize: 13 }}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>
                            本文（任意）
                          </label>
                          <textarea
                            className="form-input"
                            value={card.body}
                            onChange={(e) => updateCard(index, "body", e.target.value)}
                            placeholder="カードの説明文"
                            maxLength={500}
                            rows={2}
                            style={{ fontSize: 13, resize: "vertical" }}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>
                            画像 URL（任意）
                          </label>
                          <input
                            type="url"
                            className="form-input"
                            value={card.image_url}
                            onChange={(e) => updateCard(index, "image_url", e.target.value)}
                            placeholder="https://example.com/image.png"
                            style={{ fontFamily: "monospace", fontSize: 12 }}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 8 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>
                            ボタンラベル（任意）
                          </label>
                          <input
                            type="text"
                            className="form-input"
                            value={card.button_label}
                            onChange={(e) => updateCard(index, "button_label", e.target.value)}
                            placeholder="例: 詳しく見る"
                            maxLength={50}
                            style={{ fontSize: 13 }}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label style={{ ...fieldLabel, fontSize: 12 }}>
                            ボタン URL（任意）
                          </label>
                          <input
                            type="url"
                            className="form-input"
                            value={card.button_url}
                            onChange={(e) => updateCard(index, "button_url", e.target.value)}
                            placeholder="https://example.com/"
                            style={{ fontFamily: "monospace", fontSize: 12 }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {form.carousel_items.length < 10 && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 13, padding: "6px 14px" }}
                      onClick={addCard}
                    >
                      ＋ カードを追加
                    </button>
                  )}
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="notify_text_carousel">
                    通知メッセージ（任意）
                  </label>
                  <input
                    id="notify_text_carousel"
                    type="text"
                    className="form-input"
                    value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)}
                    placeholder="例: カルーセルが届きました"
                    maxLength={200}
                  />
                </div>
              </>
            )}

            {/* ── ボイス ── */}
            {mtype === "voice" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel} htmlFor="asset_url_voice">
                    音声ファイル URL <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    id="asset_url_voice"
                    type="url"
                    className="form-input"
                    value={form.asset_url}
                    onChange={(e) => set("asset_url", e.target.value)}
                    placeholder="https://example.com/audio.m4a"
                    style={{ fontFamily: "monospace", fontSize: 13 }}
                  />
                  <div style={hintText}>
                    LINE が対応する音声形式: M4A (AAC)・最大60秒
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="notify_text_voice">
                    通知メッセージ（任意）
                  </label>
                  <input
                    id="notify_text_voice"
                    type="text"
                    className="form-input"
                    value={form.notify_text}
                    onChange={(e) => set("notify_text", e.target.value)}
                    placeholder="例: ボイスメッセージが届きました"
                    maxLength={200}
                  />
                </div>
              </>
            )}
          </div>
          )} {/* /!isPuzzle */}

          {/* ════════════════════════════════════════
              クイックリプライ設定（メッセージ・謎 共通）
          ════════════════════════════════════════ */}
          <QuickReplyEditor
            items={form.quick_replies}
            onChange={(items) => set("quick_replies", items)}
            messages={allMessages}
            phases={phases}
          />

          {/* ════════════════════════════════════════
              連続送信設定
          ════════════════════════════════════════ */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={sectionHeader}>🔗 連続送信</div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={fieldLabel} htmlFor="next_message_id">
                次に送信するメッセージ
                <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>（任意）</span>
              </label>
              <select
                id="next_message_id"
                className="form-input"
                value={form.next_message_id}
                onChange={(e) => set("next_message_id", e.target.value)}
              >
                <option value="">（なし）</option>
                {allMessages.map((m) => (
                  <option key={m.id} value={m.id}>
                    [{m.kind}] {m.body ? m.body.slice(0, 50) : `(ID: ${m.id.slice(0, 8)}...)`}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                設定すると、このメッセージが送信された直後に続けて指定メッセージも送信されます。
              </div>
            </div>
          </div>

          {/* ════════════════════════════════════════
              謎の回答設定（puzzle のみ）
          ════════════════════════════════════════ */}
          {isPuzzle && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={sectionHeader}>⚙️ 謎の回答設定</div>

            {/* answer */}
            <div className="form-group">
              <label style={fieldLabel} htmlFor="puzzle_answer">
                答え <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input
                id="puzzle_answer"
                type="text"
                className="form-input"
                value={form.answer}
                onChange={(e) => set("answer", e.target.value)}
                placeholder="例: 桜"
                maxLength={200}
              />
            </div>

            {/* answer_match_type */}
            <div className="form-group">
              <label style={fieldLabel}>照合方法 <span style={{ color: "#dc2626" }}>*</span></label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(
                  [
                    { value: "exact" as const,              label: "完全一致",       desc: "NFKC正規化後に完全一致するか確認します" },
                    { value: "normalize_width" as const,    label: "全角半角を無視",  desc: "全角・半角の違いを無視して照合します" },
                    { value: "ignore_punctuation" as const, label: "句読点を無視",    desc: "句点・読点・記号を除去して照合します" },
                  ]
                ).map(({ value, label, desc }) => (
                  <label key={value} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={form.answer_match_type.includes(value)}
                      onChange={() => toggleMatchType(value)}
                      style={{ marginTop: 2 }}
                    />
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{label}</span>
                      <div style={hintText}>{desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* correct_action */}
            <div className="form-group">
              <label style={fieldLabel}>正解時アクション <span style={{ color: "#dc2626" }}>*</span></label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(
                  [
                    { value: "text" as const,                label: "テキスト返信のみ",       desc: "正解メッセージを返信してフェーズはそのまま" },
                    { value: "transition" as const,          label: "フェーズ遷移のみ",        desc: "指定フェーズへ遷移してそのフェーズのメッセージを送信" },
                    { value: "text_and_transition" as const, label: "テキスト＋フェーズ遷移",  desc: "正解メッセージを送信しつつ次フェーズへ遷移" },
                  ]
                ).map(({ value, label, desc }) => (
                  <label key={value} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="correct_action"
                      value={value}
                      checked={form.correct_action === value}
                      onChange={() => set("correct_action", value)}
                      style={{ marginTop: 3 }}
                    />
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{label}</span>
                      <div style={hintText}>{desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* correct_text */}
            {(form.correct_action === "text" || form.correct_action === "text_and_transition") && (
            <div className="form-group">
              <label style={fieldLabel} htmlFor="correct_text">
                正解メッセージ <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <textarea
                id="correct_text"
                className="form-input"
                style={{ minHeight: 80, resize: "vertical" }}
                value={form.correct_text}
                onChange={(e) => set("correct_text", e.target.value)}
                placeholder="例: 正解！よく気づきましたね。"
                maxLength={1000}
              />
            </div>
            )}

            {/* correct_next_phase_id */}
            {(form.correct_action === "transition" || form.correct_action === "text_and_transition") && (
            <div className="form-group">
              <label style={fieldLabel} htmlFor="correct_next_phase">
                遷移先フェーズ <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <select
                id="correct_next_phase"
                className="form-input"
                value={form.correct_next_phase_id}
                onChange={(e) => set("correct_next_phase_id", e.target.value)}
              >
                <option value="">— フェーズを選択 —</option>
                {phases.map((ph) => (
                  <option key={ph.id} value={ph.id}>{ph.name}</option>
                ))}
              </select>
            </div>
            )}

            {/* incorrect_text */}
            <div className="form-group">
              <label style={fieldLabel} htmlFor="incorrect_text">不正解メッセージ（任意）</label>
              <input
                id="incorrect_text"
                type="text"
                className="form-input"
                value={form.incorrect_text}
                onChange={(e) => set("incorrect_text", e.target.value)}
                placeholder="例: 答えが違います。もう一度考えてみてください。"
                maxLength={400}
              />
              <div style={hintText}>空欄の場合: 「答えが違います。もう一度考えてみてください。」が使われます</div>
            </div>

            {/* incorrect_quick_replies */}
            <div className="form-group">
              <label style={fieldLabel}>不正解時クイックリプライ（任意）</label>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                不正解メッセージに添付するクイックリプライボタン（最大13件）
              </div>
              <QuickReplyEditor
                items={form.incorrect_quick_replies}
                onChange={(items) => set("incorrect_quick_replies", items)}
                messages={allMessages}
                phases={phases}
              />
            </div>

            {/* puzzle_hint_text */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={fieldLabel} htmlFor="puzzle_hint_text">ヒントテキスト（任意）</label>
              <textarea
                id="puzzle_hint_text"
                className="form-input"
                style={{ minHeight: 70, resize: "vertical" }}
                value={form.puzzle_hint_text}
                onChange={(e) => set("puzzle_hint_text", e.target.value)}
                placeholder="ユーザーがヒントを求めたときに送信するテキスト"
                maxLength={1000}
              />
            </div>
          </div>
          )} {/* /isPuzzle 謎の回答設定 */}

          {/* ── アクション ── */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 4,
            }}
          >
            {!isNew && onDelete ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={deleting || submitting}
                onClick={() => {
                  if (confirm("このメッセージを削除しますか？")) onDelete?.();
                }}
              >
                {deleting ? (
                  <><span className="spinner" /> 削除中…</>
                ) : (
                  "削除"
                )}
              </button>
            ) : (
              <div />
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <Link href={`/oas/${oaId}/works/${workId}/messages`} className="btn btn-ghost">
                キャンセル
              </Link>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? (
                  <><span className="spinner" /> 保存中…</>
                ) : isNew ? (
                  "作成"
                ) : (
                  "保存"
                )}
              </button>
            </div>
          </div>
        </form>

        {/* ── 右カラム: LINEプレビュー（sticky） ── */}
        <div className="msg-preview-col">
          {/* ラベル */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            marginBottom: 8,
          }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: "#06C755",
              background: "#E6F7ED", borderRadius: 6,
              padding: "2px 8px", border: "1px solid #06C75533",
              letterSpacing: 0.5,
            }}>
              LINE プレビュー
            </span>
            <span style={{ fontSize: 10, color: "#9ca3af" }}>
              編集内容がリアルタイム反映されます
            </span>
          </div>
          <PreviewPanel
            form={form}
            characters={characters}
            riddles={riddles}
          />
        </div>
      </div>
    </>
  );
}
