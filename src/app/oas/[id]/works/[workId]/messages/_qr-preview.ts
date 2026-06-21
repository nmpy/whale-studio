// src/app/oas/[id]/works/[workId]/messages/_qr-preview.ts
//
// QR を押した時に「実際に何が送られるか」を、実送信ロジックと同じ規則で算出する純関数。
// CMS の配信単位プレビュー / 5通超え警告 / target_message_id 注記 に使う。
//
// 実送信仕様（webhook/route.ts・lib/line.ts）との対応:
//   - QR target_message_id → buildMessageChain(target): その message の next_message_id chain のみ。
//       最大 5 通（LINE Reply 上限）。free_input_enabled の message で停止（含む）。
//       6 通目以降は buildMessageChain の上限で「無送信（dropped）」。同フェーズの他 head は送らない。
//   - QR target_phase_id → buildPhaseMessages(phase): フェーズ内の全 head（continuation 除く）を
//       入力順に走査し、各 chain を最大 5 通 walk。最初の free_input_enabled で全停止。
//       合計が 5 を超えると 6 通目以降は Push fallback（月間上限時は未達）。
//   - response_message_id のみ → buildMessageChain(response) と同じ（message_chain 扱い）。

import { collectChainContinuationIds, LINE_REPLY_MAX } from "./_list-helpers";

export type QrPreviewMessage = {
  id:                  string;
  body?:               string | null;
  message_type?:       string;
  next_message_id?:    string | null;
  free_input_enabled?: boolean | null;
  phase_id?:           string | null;
  sort_order?:         number;
  /** QuickReply を持つか。フェーズ入場プレビューを実送信（buildPhaseMessages）に合わせ、
   *  QR 提示メッセージで phase 走査を停止するために使う（QR後の head はユーザー選択後に送られる）。 */
  has_quick_reply?:    boolean;
};

export type QrPreviewInput = {
  action?:              string;
  enabled?:             boolean;
  target_type?:         "phase" | "message";
  target_message_id?:   string;
  target_phase_id?:     string;
  response_message_id?: string;
};

export type QrSendPreview = {
  /** 送信の決まり方 */
  mode:         "message_chain" | "phase_entry" | "response_chain" | "none";
  /** 実際に届く想定のメッセージ（送信順・上限考慮済み） */
  messages:     QrPreviewMessage[];
  /** 届く想定の通数（= messages.length） */
  total:        number;
  /** chain の実長（message_chain/response_chain のみ。5 を超えると 6 通目以降 dropped を示す用） */
  fullTotal:    number;
  /** 5 通を超えるか */
  overLimit:    boolean;
  /** 超過時の扱い: message/response chain は "dropped"(6通目以降 無送信) / phase は "push"(Push送信) */
  overflowKind: "dropped" | "push" | null;
};

/** head から next_message_id を walk（free_input で停止・含む）。cap で打ち切り。 */
function walkChain(byId: Map<string, QrPreviewMessage>, headId: string, cap: number): QrPreviewMessage[] {
  const out: QrPreviewMessage[] = [];
  const seen = new Set<string>();
  let cur: string | null = headId;
  while (cur && !seen.has(cur) && out.length < cap) {
    const m = byId.get(cur);
    if (!m) break;
    seen.add(cur);
    out.push(m);
    if (m.free_input_enabled) break; // freeInput プロンプトで停止（この message は含む）
    cur = m.next_message_id ?? null;
  }
  return out;
}

/** buildPhaseMessages 相当: フェーズ入場時に「最初のQR/入力待ちまで」に送られるメッセージ列。
 *  実送信（src/lib/line.ts buildPhaseMessages）と停止条件を揃える:
 *    - 各 chain は free_input で停止（その message は含む）・最大 LINE_REPLY_MAX 件。
 *    - chain に free_input か QuickReply があれば、その chain まで含めて phase 走査を停止する
 *      （QR 提示後の後続 head はユーザー選択後に送られるため、入場時には送らない）。 */
export function phaseEntryMessages(phaseMessages: QrPreviewMessage[]): QrPreviewMessage[] {
  const sorted = [...phaseMessages].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.id).localeCompare(String(b.id)),
  );
  const byId = new Map(sorted.map((m) => [m.id, m]));
  const contIds = collectChainContinuationIds(sorted.map((m) => ({ id: m.id, next_message_id: m.next_message_id })));
  const out: QrPreviewMessage[] = [];
  for (const head of sorted) {
    if (contIds.has(head.id)) continue;
    let cur: QrPreviewMessage | undefined = head;
    const seen = new Set<string>([head.id]);
    let n = 0;
    let stopFreeInput = false;
    let chainHasQr = false;
    while (cur && n < LINE_REPLY_MAX) {
      n++;
      out.push(cur);
      if (cur.has_quick_reply) chainHasQr = true; // QR は chain 内では止めず、chain 完了後に phase 走査を停止
      if (cur.free_input_enabled) { stopFreeInput = true; break; }
      const nx = cur.next_message_id;
      if (!nx || seen.has(nx) || !byId.has(nx)) break;
      seen.add(nx);
      cur = byId.get(nx);
    }
    // free_input または QR を含む chain まででフェーズ全体の走査を停止（実送信と同じ境界）。
    if (stopFreeInput || chainHasQr) break;
  }
  return out;
}

/** QR を押した時に送られるメッセージを実送信規則どおりに算出する。 */
export function previewQrSend(qr: QrPreviewInput, allMessages: QrPreviewMessage[]): QrSendPreview {
  const byId = new Map(allMessages.map((m) => [m.id, m]));

  const chainResult = (headId: string, mode: "message_chain" | "response_chain"): QrSendPreview => {
    const full = walkChain(byId, headId, Number.MAX_SAFE_INTEGER); // 実長（freeInput停止）
    const delivered = full.slice(0, LINE_REPLY_MAX);               // 実際に届く（最大5）
    const over = full.length > LINE_REPLY_MAX;
    return { mode, messages: delivered, total: delivered.length, fullTotal: full.length, overLimit: over, overflowKind: over ? "dropped" : null };
  };

  if (qr.target_type === "message" && qr.target_message_id) {
    return chainResult(qr.target_message_id, "message_chain");
  }
  if (qr.target_phase_id) {
    const phaseMsgs = allMessages.filter((m) => m.phase_id === qr.target_phase_id);
    const sent = phaseEntryMessages(phaseMsgs);
    const over = sent.length > LINE_REPLY_MAX;
    return { mode: "phase_entry", messages: sent, total: sent.length, fullTotal: sent.length, overLimit: over, overflowKind: over ? "push" : null };
  }
  if (qr.response_message_id) {
    return chainResult(qr.response_message_id, "response_chain");
  }
  return { mode: "none", messages: [], total: 0, fullTotal: 0, overLimit: false, overflowKind: null };
}
