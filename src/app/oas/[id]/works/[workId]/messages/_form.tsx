// src/app/oas/[id]/works/[workId]/messages/_form.tsx
// 共有メッセージフォーム（新規・編集ページで使用）

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { phaseApi, characterApi, riddleApi, getDevToken } from "@/lib/api-client";
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
  | "voice"
  | "flex";

// ── 定数 ────────────────────────────────────────────────

export const MESSAGE_TYPE_OPTIONS: {
  value: ExtendedMessageType;
  label: string;
  icon: string;
  desc: string;
}[] = [
  { value: "text",     label: "テキスト",     icon: "💬", desc: "テキストメッセージ" },
  { value: "image",    label: "画像",         icon: "🖼",  desc: "画像メッセージ" },
  { value: "riddle",   label: "謎",           icon: "🔍", desc: "謎チャレンジメッセージ" },
  { value: "video",    label: "動画",         icon: "🎬", desc: "動画メッセージ" },
  { value: "carousel", label: "カルーセル",   icon: "🎠", desc: "カルーセルメッセージ" },
  { value: "voice",    label: "ボイス",       icon: "🎙", desc: "ボイスメッセージ" },
  { value: "flex",     label: "Flex",         icon: "🪄", desc: "Flex Message" },
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

export type MessageKind = "start" | "normal" | "response" | "hint" | "puzzle";
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
  alt_text:        string;
  flex_json:       string;
  sort_order:      number;
  is_active:       boolean;
  // ── 謎（puzzle）専用フィールド ──
  puzzle_type:           string;
  answer:                string;
  puzzle_hint_text:      string;
  answer_match_type:     AnswerMatchType[];
  correct_action:        CorrectAction;
  correct_text:          string;
  incorrect_text:        string;
  correct_next_phase_id: string;
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
  alt_text:        "",
  flex_json:       "",
  sort_order:      0,
  is_active:       true,
  // puzzle defaults
  puzzle_type:           "",
  answer:                "",
  puzzle_hint_text:      "",
  answer_match_type:     ["exact"],
  correct_action:        "text",
  correct_text:          "",
  incorrect_text:        "",
  correct_next_phase_id: "",
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
  alt_text?:             string | null;
  flex_payload_json?:    string | null;
  puzzle_type?:          string | null;
  answer?:               string | null;
  puzzle_hint_text?:     string | null;
  answer_match_type?:    string[] | null;
  correct_action?:       string | null;
  correct_text?:         string | null;
  incorrect_text?:       string | null;
  correct_next_phase_id?: string | null;
  sort_order?:           number;
  is_active?:            boolean;
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
    alt_text:              msg.alt_text         ?? "",
    flex_json:             msg.flex_payload_json ?? "",
    sort_order:            msg.sort_order      ?? 0,
    is_active:             msg.is_active       ?? true,
    puzzle_type:           msg.puzzle_type     ?? "",
    answer:                msg.answer          ?? "",
    puzzle_hint_text:      msg.puzzle_hint_text ?? "",
    answer_match_type:     (msg.answer_match_type ?? ["exact"]) as AnswerMatchType[],
    correct_action:        (msg.correct_action ?? "text") as CorrectAction,
    correct_text:          msg.correct_text    ?? "",
    incorrect_text:        msg.incorrect_text  ?? "",
    correct_next_phase_id: msg.correct_next_phase_id ?? "",
  };
}

export function formStateToMsgBody(form: MessageFormState) {
  const isPuzzle = form.kind === "puzzle";
  return {
    trigger_keyword:  form.trigger_keyword || null,
    target_segment:   form.target_segment  || null,
    phase_id:         form.phase_id        || null,
    character_id:     form.character_id    || null,
    // puzzle も message_type をそのまま使う（画像・動画・カルーセル謎に対応）
    message_type:     form.message_type,
    kind:             form.kind,
    body:
      form.message_type === "carousel"
        ? JSON.stringify(form.carousel_items)
        : form.message_type === "text"
        ? form.body || undefined
        : undefined,
    asset_url:         (form.message_type === "image" || form.message_type === "video" || form.message_type === "voice")
      ? form.asset_url || undefined
      : undefined,
    notify_text:       form.message_type !== "text" && form.message_type !== "flex"
      ? form.notify_text || undefined
      : undefined,
    riddle_id:         !isPuzzle ? (form.riddle_id || null) : null,
    quick_replies:     isPuzzle ? null : (form.quick_replies.length > 0 ? form.quick_replies : null),
    alt_text:          !isPuzzle && form.message_type === "flex" ? form.alt_text || null : null,
    flex_payload_json: !isPuzzle && form.message_type === "flex" ? form.flex_json || null : null,
    sort_order:        form.sort_order,
    is_active:         form.is_active,
    // puzzle fields
    puzzle_type:           isPuzzle ? form.puzzle_type || null : null,
    answer:                isPuzzle ? form.answer || null : null,
    puzzle_hint_text:      isPuzzle ? form.puzzle_hint_text || null : null,
    answer_match_type:     isPuzzle ? form.answer_match_type : ["exact"],
    correct_action:        isPuzzle ? form.correct_action || null : null,
    correct_text:          isPuzzle ? form.correct_text || null : null,
    incorrect_text:        isPuzzle ? form.incorrect_text || null : null,
    correct_next_phase_id: isPuzzle ? form.correct_next_phase_id || null : null,
  };
}

// ── バリデーション ────────────────────────────────────────

export function validateMessageForm(form: MessageFormState): string | null {
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
  if (form.message_type === "flex") {
    if (!form.alt_text.trim()) return "altTextを入力してください";
    if (!form.flex_json.trim()) return "Flex Message JSONを入力してください";
    try { JSON.parse(form.flex_json); } catch {
      return "JSONの形式が正しくありません";
    }
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
    hint: "タップするとヒントメッセージを送信します",
    valueLabel: "ヒントキーワード（任意）",
    valuePlaceholder: "省略時はデフォルトヒント",
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

// ────────────────────────────────────────────────────────
// QuickReplyEditor コンポーネント
// ────────────────────────────────────────────────────────

interface QuickReplyEditorProps {
  items:    QuickReplyItem[];
  onChange: (items: QuickReplyItem[]) => void;
}

function QuickReplyEditor({ items, onChange }: QuickReplyEditorProps) {
  const [open, setOpen] = useState(false);

  // 自動展開: 既存データがある場合は初期表示で開く
  useEffect(() => {
    if (items.length > 0) setOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addItem() {
    if (items.length >= 13) return;
    onChange([...items, { ...EMPTY_QR }]);
    setOpen(true);
  }

  function updateItem(index: number, patch: Partial<QuickReplyItem>) {
    onChange(items.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    cursor: "pointer",
    userSelect: "none",
  };

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
              {items.length}件
            </span>
          )}
        </div>
        <span style={{ fontSize: 16, color: "#9ca3af", lineHeight: 1 }}>
          {open ? "▲" : "▼"}
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          {/* ヒント */}
          <p style={{ ...hintText, marginBottom: 14 }}>
            メッセージの下に表示される選択肢ボタンです。LINE 仕様: 最大13件 / ラベル最大20文字
          </p>

          {/* アイテム一覧 */}
          {items.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
              {items.map((item, index) => {
                const actionDef = QR_ACTION_OPTIONS.find((o) => o.value === item.action);
                // 値フィールドは全アクション種別で常に表示（ヒント目的の変数宣言除去）

                return (
                  <div
                    key={index}
                    style={{
                      padding: "12px 14px",
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      background: "#fafafa",
                    }}
                  >
                    {/* ヘッダー行: 番号 + 削除 */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                        #{index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        style={{
                          fontSize: 11, padding: "2px 8px", border: "1px solid #fecaca",
                          borderRadius: 6, background: "#fff5f5", color: "#ef4444",
                          cursor: "pointer", lineHeight: 1.5,
                        }}
                      >
                        削除
                      </button>
                    </div>

                    {/* ラベル */}
                    <div className="form-group" style={{ marginBottom: 8 }}>
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

                    {/* アクション種別 */}
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label style={{ ...fieldLabel, fontSize: 12 }}>アクション種別</label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {QR_ACTION_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => updateItem(index, { action: opt.value })}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              padding: "5px 10px",
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 500,
                              cursor: "pointer",
                              transition: "all 0.12s",
                              border: item.action === opt.value
                                ? "2px solid #06C755"
                                : "2px solid #e5e7eb",
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

                    {/* 値（アクション種別に応じたラベル） */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ ...fieldLabel, fontSize: 12 }}>
                        {actionDef?.valueLabel ?? "値"}
                        {item.action !== "url" && (
                          <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 4 }}>（任意）</span>
                        )}
                        {item.action === "url" && (
                          <span style={{ color: "#dc2626", marginLeft: 4 }}>*</span>
                        )}
                      </label>
                      <input
                        type={item.action === "url" ? "url" : "text"}
                        className="form-input"
                        value={item.value ?? ""}
                        onChange={(e) => updateItem(index, { value: e.target.value || undefined })}
                        placeholder={actionDef?.valuePlaceholder}
                        maxLength={500}
                        style={{ fontSize: 13, fontFamily: item.action === "url" ? "monospace" : undefined }}
                      />
                    </div>
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
      case "text":
        return form.body
          ? <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{form.body}</span>
          : <span style={{ color: "#aaa", fontStyle: "italic" }}>テキストを入力してください</span>;
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
      case "flex":
        return (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <span style={{ fontSize: 20 }}>🪄</span>
            <div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>Flex Message</div>
              {form.alt_text
                ? <div style={{ fontSize: 13, color: "#111", fontWeight: 500 }}>{form.alt_text}</div>
                : <span style={{ color: "#aaa", fontStyle: "italic", fontSize: 12 }}>代替テキストを入力してください</span>
              }
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
      width: 300, flexShrink: 0,
      border: "1px solid #d1d5db", borderRadius: 14,
      overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
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
  const [flexHelpOpen, setFlexHelpOpen] = useState(false);

  const isPuzzle = form.kind === "puzzle";

  const [phases, setPhases]         = useState<PhaseWithCounts[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [riddles, setRiddles]       = useState<Riddle[]>([]);

  useEffect(() => {
    const token = getDevToken();
    Promise.all([
      phaseApi.list(token, workId),
      characterApi.list(token, workId),
      riddleApi.list(token, oaId),
    ]).then(([ph, ch, rd]) => {
      setPhases(ph);
      setCharacters(ch);
      setRiddles(rd);
    }).catch(() => {});
  }, [workId, oaId]);

  function set<K extends keyof MessageFormState>(k: K, v: MessageFormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
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
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            ...(workTitle ? [{ label: workTitle }] : []),
            { label: "メッセージ管理", href: `/oas/${oaId}/works/${workId}/messages` },
            { label: isNew ? "新規作成" : "編集" },
          ]} />
          <h2>{isNew ? "メッセージを追加" : "メッセージを編集"}</h2>
        </div>
      </div>

      {/* ── 2カラムレイアウト ── */}
      <div
        style={{
          display: "flex",
          gap: 24,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {/* ── 左カラム: フォーム ── */}
        <form
          onSubmit={handleSubmit}
          style={{ flex: 1, minWidth: 0 }}
        >
          {/* エラーアラート */}
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* ════════════════════════════════════════
              トップレベル: メッセージ / 謎 切り替え
          ════════════════════════════════════════ */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={sectionHeader}>種類</div>
            <div style={{ display: "flex", gap: 10 }}>
              {(
                [
                  { value: false, label: "💬 メッセージ", desc: "テキスト・画像などのメッセージ" },
                  { value: true,  label: "🧩 謎",         desc: "答え合わせ付きのインライン謎" },
                ] as const
              ).map(({ value, label, desc }) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => set("kind", value ? "puzzle" : "normal")}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: isPuzzle === value ? "2px solid #06C755" : "2px solid #e5e5e5",
                    background: isPuzzle === value ? "#E6F7ED" : "#fff",
                    color: isPuzzle === value ? "#06C755" : "#6b7280",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
                  <div style={{ fontSize: 11, color: isPuzzle === value ? "#059669" : "#9ca3af", marginTop: 2 }}>{desc}</div>
                </button>
              ))}
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
              </select>
              <div style={hintText}>
                {form.kind === "start" && "開始フェーズの startTrigger が一致したとき送信されます。フェーズに kind=start のメッセージがない場合は通常メッセージにフォールバックします。"}
                {form.kind === "response" && "trigger_keyword が一致したときのみ返信します。フェーズは進みません。"}
                {form.kind === "normal" && "フェーズ遷移時またはフェーズ表示時に送信されます。"}
                {form.kind === "hint" && "ヒント用メッセージです（将来拡張）。"}
              </div>
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
                placeholder="例: スタート"
                maxLength={100}
                disabled={form.kind === "start"}
                style={form.kind === "start" ? { opacity: 0.5 } : undefined}
              />
              <div style={hintText}>
                {form.kind === "start" ? "kind=start では Phase.startTrigger を使います" : "このキーワードを受信したとき送信します（kind=response 推奨）"}
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

            {/* フェーズ */}
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
              セクション 3a: 謎（puzzle）設定
          ════════════════════════════════════════ */}
          {isPuzzle && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={sectionHeader}>🧩 謎の設定</div>

            {/* ── 配信形式（puzzle 用） ── */}
            <div className="form-group">
              <label style={fieldLabel}>配信形式</label>
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
              <div style={hintText}>謎の問題をどの形式で送信するか選択してください</div>
            </div>

            {/* puzzle_type */}
            <div className="form-group">
              <label style={fieldLabel} htmlFor="puzzle_type">謎の種類（任意）</label>
              <input
                id="puzzle_type"
                type="text"
                className="form-input"
                value={form.puzzle_type}
                onChange={(e) => set("puzzle_type", e.target.value)}
                placeholder="例: 暗号解読、並べ替え、虫食い…"
                maxLength={100}
              />
              <div style={hintText}>管理用のメモ。ユーザーには表示されません</div>
            </div>

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
                    { value: "exact" as const,             label: "完全一致",     desc: "NFKC正規化後に完全一致するか確認します" },
                    { value: "normalize_width" as const,   label: "全角半角を無視", desc: "全角・半角の違いを無視して照合します" },
                    { value: "ignore_punctuation" as const, label: "句読点を無視",  desc: "句点・読点・記号を除去して照合します" },
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

            {/* puzzle_hint_text */}
            <div className="form-group">
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

            {/* correct_action */}
            <div className="form-group">
              <label style={fieldLabel}>正解時アクション <span style={{ color: "#dc2626" }}>*</span></label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(
                  [
                    { value: "text" as const,              label: "テキスト返信のみ",     desc: "正解メッセージを返信してフェーズはそのまま" },
                    { value: "transition" as const,        label: "フェーズ遷移のみ",      desc: "指定フェーズへ遷移してそのフェーズのメッセージを送信" },
                    { value: "text_and_transition" as const, label: "テキスト＋フェーズ遷移", desc: "正解メッセージを送信しつつ次フェーズへ遷移" },
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
            <div className="form-group" style={{ marginBottom: 0 }}>
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
          </div>
          )} {/* /isPuzzle section 3a */}

          {/* ════════════════════════════════════════
              セクション 3c: 謎の問題コンテンツ（puzzle のみ・配信形式に応じて切り替え）
          ════════════════════════════════════════ */}
          {isPuzzle && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={sectionHeader}>📨 謎の問題コンテンツ</div>

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
          )} {/* /isPuzzle section 3c */}

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
                  id="body"
                  className="form-input"
                  style={{ minHeight: 100, resize: "vertical" }}
                  value={form.body}
                  onChange={(e) => set("body", e.target.value)}
                  placeholder="送信するテキストを入力してください"
                  maxLength={5000}
                />
                <div style={{ ...hintText, textAlign: "right" }}>
                  {form.body.length} / 5000
                </div>
              </div>
            )}

            {/* ── Flex Message ── */}
            {mtype === "flex" && (
              <>
                <div className="form-group">
                  <label style={fieldLabel} htmlFor="flex_alt_text">
                    代替テキスト <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    id="flex_alt_text"
                    type="text"
                    className="form-input"
                    value={form.alt_text}
                    onChange={(e) => set("alt_text", e.target.value)}
                    placeholder="通知や未対応環境向けに表示するテキストを入力してください"
                    maxLength={400}
                  />
                  <div style={hintText}>LINE 通知欄や未対応端末に表示されるテキストです</div>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={fieldLabel} htmlFor="flex_json">
                    Flex Message JSON <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <textarea
                    id="flex_json"
                    className="form-input"
                    style={{ minHeight: 180, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                    value={form.flex_json}
                    onChange={(e) => set("flex_json", e.target.value)}
                    placeholder={'Flex MessageのJSONを入力してください\n例: {"type":"bubble","body":{"type":"box","layout":"vertical","contents":[{"type":"text","text":"Hello"}]}}'}
                    spellCheck={false}
                  />
                  {form.flex_json.trim() && (() => {
                    try { JSON.parse(form.flex_json); return null; } catch {
                      return (
                        <div style={{ marginTop: 4, fontSize: 12, color: "#dc2626", display: "flex", alignItems: "center", gap: 4 }}>
                          ⚠️ JSONの形式が正しくありません
                        </div>
                      );
                    }
                  })()}
                  <div style={hintText}>{"type: \"bubble\" または \"carousel\" を指定できます"}</div>
                </div>

                {/* ── Flex Message 説明トグル ── */}
                <div>
                  <button
                    type="button"
                    onClick={() => setFlexHelpOpen((v) => !v)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      fontSize: 13,
                      color: "#4b5563",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span>{flexHelpOpen ? "▼" : "▶"}</span>
                    <span>Flex Messageの例を見る</span>
                  </button>
                  {flexHelpOpen && (
                    <div style={{
                      marginTop: 10,
                      padding: "12px 14px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "#374151",
                      lineHeight: 1.7,
                    }}>
                      <p style={{ margin: "0 0 8px", fontWeight: 600 }}>作品紹介カードの例（bubble）</p>
                      <pre style={{
                        margin: 0,
                        overflowX: "auto",
                        fontFamily: "monospace",
                        fontSize: 11,
                        background: "#1e293b",
                        color: "#e2e8f0",
                        padding: "10px 12px",
                        borderRadius: 6,
                        whiteSpace: "pre",
                      }}>{`{
  "type": "bubble",
  "body": {
    "type": "box",
    "layout": "vertical",
    "contents": [
      {
        "type": "text",
        "text": "既読無視しないで。",
        "weight": "bold",
        "size": "xl"
      },
      {
        "type": "text",
        "text": "未読のまま止まったチャット。",
        "size": "sm",
        "color": "#666666"
      }
    ]
  },
  "footer": {
    "type": "button",
    "style": "primary",
    "action": {
      "type": "postback",
      "label": "体験をはじめる",
      "data": "action=start_work&work_id=1"
    }
  }
}`}</pre>
                      <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: 11 }}>
                        上記 JSON をそのままコピーして貼り付け、テキストや色をカスタマイズしてください。
                      </p>
                    </div>
                  )}
                </div>
              </>
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
              セクション 4: クイックリプライ設定（puzzle のときは非表示）
          ════════════════════════════════════════ */}
          {!isPuzzle && (
          <QuickReplyEditor
            items={form.quick_replies}
            onChange={(items) => set("quick_replies", items)}
          />
          )}

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

        {/* ── 右カラム: LINEプレビュー ── */}
        <div style={{ flexShrink: 0 }}>
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
