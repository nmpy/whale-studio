// src/lib/message-option-label.ts
//
// メッセージ選択 UI（Location の「QR成功時に送るメッセージ」等）の option ラベルを組み立てる純関数。
// 既存のメッセージ一覧表記（フェーズ名 + 本文抜粋 + 種別）に寄せる。UI から切り出してテスト可能にする。

const MESSAGE_TYPE_LABEL: Record<string, string> = {
  text:     "テキスト",
  image:    "画像",
  video:    "動画",
  carousel: "カルーセル",
  voice:    "ボイス",
  riddle:   "謎",
  flex:     "Flex",
};

const MAX_BODY = 24;

export interface MessageOptionInput {
  body?:         string | null;
  message_type?: string | null;
  phase?:        { name?: string | null } | null;
}

/**
 * メッセージ option の表示ラベルを返す。
 * 例: "受付フェーズ: いらっしゃいませ…"、本文が無い種別は "受付フェーズ: （画像）"。
 * フェーズ未設定なら接頭辞なし。削除済み等で空入力でも壊れない（"（メッセージ）" を返す）。
 */
export function formatMessageOptionLabel(m: MessageOptionInput): string {
  const phasePrefix = m.phase?.name ? `${m.phase.name}: ` : "";
  const raw = (m.body ?? "").replace(/\s+/g, " ").trim();
  const typeLabel = MESSAGE_TYPE_LABEL[m.message_type ?? "text"] ?? (m.message_type ?? "メッセージ");
  const text = raw
    ? (raw.length > MAX_BODY ? `${raw.slice(0, MAX_BODY)}…` : raw)
    : `（${typeLabel}）`;
  return `${phasePrefix}${text}`;
}
