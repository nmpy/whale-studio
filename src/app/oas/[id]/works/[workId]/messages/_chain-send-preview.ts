// src/app/oas/[id]/works/[workId]/messages/_chain-send-preview.ts
//
// 連続メッセージ編集画面用の「実送信プレビュー」純関数。
// 編集中の form state（head + additionalMessages スロット列）から、
// runtime（buildMessageChain/buildPhaseMessages）と同じ規則で
// 「1回の送信で届くメッセージ」と「自由入力後に届く応答」を分離して算出する。
//
// runtime 準拠ルール:
//   - head から slot を順に送る。
//   - free_input_enabled の message に達したら、それを含めて即時送信は停止（= 入力待ち）。
//   - freeInput 以降の slot は通常の連続送信では届かず、入力後に freeInputNextMessageId 経由で届く
//     → 「自由入力後の応答」として別枠で見せる。
//   - 即時送信が LINE Reply 上限(5)を超えると 6 通目以降は Push/未達リスク。

import { LINE_REPLY_MAX } from "./_list-helpers";

export type ChainPreviewSlot = {
  body?:               string | null;
  message_type?:       string;
  free_input_enabled?: boolean | null;
};

export type ChainPreviewLine = { index: number; label: string; freeInput: boolean };

export type ChainSendPreview = {
  /** 即時送信されるメッセージ（head + freeInput までの slot・freeInput 含む） */
  sendMessages:     ChainPreviewLine[];
  /** 即時送信に含まれる freeInput プロンプトの位置（sendMessages 内 index）。無ければ null */
  freeInputAt:      number | null;
  /** 自由入力後に届く応答（freeInput 以降の slot） */
  responseMessages: ChainPreviewLine[];
  /** 即時送信通数（= sendMessages.length） */
  total:            number;
  /** 即時送信が 5 通を超えるか（6通目以降 Push/未達リスク） */
  overLimit:        boolean;
};

function label(m: ChainPreviewSlot): string {
  const body = (m.body ?? "").replace(/\n/g, " ").trim();
  if (body) return body.length > 28 ? body.slice(0, 28) + "…" : body;
  return `(${m.message_type ?? "メッセージ"})`;
}

/**
 * head + slots を runtime 規則で「即時送信」と「自由入力後の応答」に分割する。
 * @param head  1通目（head message）
 * @param slots 2通目以降（additionalMessages の順）
 */
export function previewChainSend(head: ChainPreviewSlot, slots: ChainPreviewSlot[]): ChainSendPreview {
  const all: ChainPreviewSlot[] = [head, ...slots];
  // 最初の freeInput 位置を探す
  let stopAt = -1;
  for (let i = 0; i < all.length; i++) {
    if (all[i].free_input_enabled) { stopAt = i; break; }
  }

  const sendSlice = stopAt >= 0 ? all.slice(0, stopAt + 1) : all;
  const respSlice = stopAt >= 0 ? all.slice(stopAt + 1) : [];

  const sendMessages: ChainPreviewLine[] = sendSlice.map((m, i) => ({ index: i + 1, label: label(m), freeInput: !!m.free_input_enabled }));
  const responseMessages: ChainPreviewLine[] = respSlice.map((m, i) => ({ index: i + 1, label: label(m), freeInput: !!m.free_input_enabled }));

  return {
    sendMessages,
    freeInputAt: stopAt >= 0 ? stopAt : null,
    responseMessages,
    total:       sendMessages.length,
    overLimit:   sendMessages.length > LINE_REPLY_MAX,
  };
}
