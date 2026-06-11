// src/lib/message-refs.ts
//
// メッセージ間参照（逆参照・削除影響範囲）の純関数。client / server 双方から使う共有モジュール。
// 読み取り専用。DB write は一切しない。
//
// 検出するメッセージ→メッセージ参照（4種）:
//   - next            : nextMessageId（連続送信）
//   - freeInputNext   : freeInputNextMessageId（自由入力後の応答）
//   - qr_target       : quickReplies[].target_message_id（QR 分岐先）
//   - qr_response     : quickReplies[].response_message_id（QR 応答メッセージ）
//
// 壊れた quick_replies（不正 JSON / 非配列 / 想定外要素）でも例外を投げず空として扱う。

export type ReferrerKind = "next" | "freeInputNext" | "qr_target" | "qr_response";

export const REFERRER_KIND_LABEL: Record<ReferrerKind, string> = {
  next:          "連続メッセージから参照",
  freeInputNext: "自由入力後の応答として参照",
  qr_target:     "QR分岐先として参照",
  qr_response:   "QR応答メッセージとして参照",
};

export type Referrer = {
  referrerId:    string;
  referrerLabel: string;
  kind:          ReferrerKind;
  /** 参照先メッセージ id（集合に対する逆参照で「どの削除対象を指すか」を示す。単体逆参照では省略可）。 */
  targetId?:     string;
};

export type RefMessage = {
  id:                          string;
  body?:                       string | null;
  message_type?:               string | null;
  next_message_id?:            string | null;
  free_input_next_message_id?: string | null;
  /** パース済み配列 / JSON 文字列 / null のいずれでも受ける（防御的に解釈）。 */
  quick_replies?:              unknown;
};

/** 本文冒頭などから表示用ラベルを作る。 */
export function refLabelOf(m: RefMessage): string {
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

/** メッセージ m が出している（メッセージ宛の）参照を列挙する。 */
function outgoingRefs(m: RefMessage): Array<{ kind: ReferrerKind; targetId: string }> {
  const refs: Array<{ kind: ReferrerKind; targetId: string }> = [];
  if (m.next_message_id) refs.push({ kind: "next", targetId: m.next_message_id });
  if (m.free_input_next_message_id) refs.push({ kind: "freeInputNext", targetId: m.free_input_next_message_id });
  for (const item of parseQr(m.quick_replies)) {
    if (typeof item.target_message_id === "string") refs.push({ kind: "qr_target", targetId: item.target_message_id });
    if (typeof item.response_message_id === "string") refs.push({ kind: "qr_response", targetId: item.response_message_id });
  }
  return refs;
}

/**
 * messageId を参照しているメッセージを列挙する（単体の逆参照・#6-4a）。
 * 自分自身による参照は含めない。
 */
export function findReferrers(messageId: string, allMessages: RefMessage[]): Referrer[] {
  const out: Referrer[] = [];
  if (!messageId) return out;
  for (const m of allMessages) {
    if (!m || m.id === messageId) continue; // 自己参照は除外
    for (const r of outgoingRefs(m)) {
      if (r.targetId === messageId) {
        out.push({ referrerId: m.id, referrerLabel: refLabelOf(m), kind: r.kind });
      }
    }
  }
  return out;
}

/**
 * root から nextMessageId 連鎖を辿り「削除対象集合」を返す（#6-4b）。
 * 現行 DELETE 挙動に合わせ root + 後続 next を最大 cap 件まで（既定 10）。循環は停止。
 * allMessages は同一 work 内のメッセージ（別 work id は Map に無いので自然に停止）。
 */
export function computeDeleteSet(rootId: string, allMessages: RefMessage[], cap = 10): string[] {
  const byId = new Map<string, RefMessage>();
  for (const m of allMessages) byId.set(m.id, m);
  const set: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = rootId;
  for (let i = 0; cur && i <= cap; i++) {
    if (seen.has(cur)) break;
    const m = byId.get(cur);
    if (!m && cur !== rootId) break; // root は集合に含める（存在前提）
    seen.add(cur);
    set.push(cur);
    cur = m?.next_message_id ?? null;
  }
  return set;
}

/**
 * 削除対象集合の「外側」から集合内メッセージを指している参照を列挙する（#6-4b ガード用）。
 * 集合内部同士の参照（root→next 等）は対象外（一緒に消えるため）。
 */
export function findExternalReferrers(deleteSet: string[], allMessages: RefMessage[]): Referrer[] {
  const set = new Set(deleteSet);
  const out: Referrer[] = [];
  for (const m of allMessages) {
    if (!m || set.has(m.id)) continue; // 参照元が集合内なら対象外
    for (const r of outgoingRefs(m)) {
      if (set.has(r.targetId)) {
        out.push({ referrerId: m.id, referrerLabel: refLabelOf(m), kind: r.kind, targetId: r.targetId });
      }
    }
  }
  return out;
}
