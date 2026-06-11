// src/app/oas/[id]/works/[workId]/messages/_chain-refs.ts
//
// メッセージの「逆参照（このメッセージはどこから参照されているか）」を求める純関数（#6-4a）。
// 読み取り専用。削除・移動の前に影響範囲を可視化するために使う（DB write は一切しない）。
//
// 検出するメッセージ→メッセージ参照（4種）:
//   - next            : nextMessageId（連続送信）
//   - freeInputNext   : freeInputNextMessageId（自由入力後の応答）
//   - qr_target       : quickReplies[].target_message_id（QR 分岐先）
//   - qr_response     : quickReplies[].response_message_id（QR 応答メッセージ）
//
// 仕様: 自分自身による参照（referrerId === messageId）は含めない
//       （同一メッセージのため削除/移動の障害にならない）。
// 壊れた quick_replies（不正 JSON / 非配列 / 想定外要素）でも例外を投げず空として扱う。

export type ReferrerKind = "next" | "freeInputNext" | "qr_target" | "qr_response";

export const REFERRER_KIND_LABEL: Record<ReferrerKind, string> = {
  next:        "連続メッセージから参照",
  freeInputNext: "自由入力後の応答として参照",
  qr_target:   "QR分岐先として参照",
  qr_response: "QR応答メッセージとして参照",
};

export type Referrer = {
  referrerId:    string;
  referrerLabel: string;
  kind:          ReferrerKind;
};

export type RefMessage = {
  id:                          string;
  body?:                       string | null;
  message_type?:               string | null;
  next_message_id?:            string | null;
  free_input_next_message_id?: string | null;
  /** 既にパース済み配列 / JSON 文字列 / null のいずれでも受ける（防御的に解釈）。 */
  quick_replies?:              unknown;
};

/** 本文冒頭などから表示用ラベルを作る。 */
function labelOf(m: RefMessage): string {
  const body = (m.body ?? "").replace(/\n/g, " ").trim();
  if (body) return body.length > 28 ? body.slice(0, 28) + "…" : body;
  return `(${m.message_type ?? "メッセージ"})`;
}

/** quick_replies を配列に正規化（不正でも落とさず []）。 */
function parseQr(qr: unknown): Array<{ target_message_id?: unknown; response_message_id?: unknown }> {
  let arr: unknown = qr;
  if (typeof qr === "string") {
    try { arr = JSON.parse(qr); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

/**
 * messageId を参照しているメッセージを列挙する。
 * 同一メッセージが複数の種類で参照していれば、種類ごとに複数件返す。
 */
export function findReferrers(messageId: string, allMessages: RefMessage[]): Referrer[] {
  const out: Referrer[] = [];
  if (!messageId) return out;

  for (const m of allMessages) {
    if (!m || m.id === messageId) continue; // 自己参照は除外

    if (m.next_message_id === messageId) {
      out.push({ referrerId: m.id, referrerLabel: labelOf(m), kind: "next" });
    }
    if (m.free_input_next_message_id === messageId) {
      out.push({ referrerId: m.id, referrerLabel: labelOf(m), kind: "freeInputNext" });
    }
    for (const item of parseQr(m.quick_replies)) {
      if (item.target_message_id === messageId) {
        out.push({ referrerId: m.id, referrerLabel: labelOf(m), kind: "qr_target" });
      }
      if (item.response_message_id === messageId) {
        out.push({ referrerId: m.id, referrerLabel: labelOf(m), kind: "qr_response" });
      }
    }
  }
  return out;
}
