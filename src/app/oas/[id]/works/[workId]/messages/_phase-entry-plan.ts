// src/app/oas/[id]/works/[workId]/messages/_phase-entry-plan.ts
//
// 「フェーズに入った瞬間に runtime が実際に送るもの」を CMS で見える化するための純関数（PR1）。
// runtime buildPhaseMessages（src/lib/line.ts）と同じ規則を再現する:
//   - entry head = phase 内で nextMessageId で参照されていない message
//     （QR target_message_id / freeInputNextMessageId で参照されているだけでは head のまま）。
//   - head を sortOrder→createdAt→id 順に走査し、各 head の next chain を最大5件展開。
//   - 最初の freeInput プロンプトに到達した時点で phase 全体の送信を停止（以降の head は入場では送られない）。
//
// あわせて「QR/自由入力応答で辿る想定なのに entry head（＝入場でも送られる二重送信）」を
// findReferrers（@/lib/message-refs）で検出し、警告材料を返す。読み取り専用・runtime 非変更。

import { findReferrers, type ReferrerKind, type RefMessage } from "@/lib/message-refs";

export const PHASE_ENTRY_REPLY_MAX = 5;

export type EntryPlanMessage = {
  id:                          string;
  body?:                       string | null;
  message_type?:               string | null;
  sort_order?:                 number | null;
  created_at?:                 string | null;
  next_message_id?:            string | null;
  free_input_enabled?:         boolean | null;
  free_input_next_message_id?: string | null;
  quick_replies?:              unknown;
};

export type EntrySendItem = {
  index:         number;   // 入場送信中の通番（1始まり）
  messageId:     string;
  label:         string;
  entryHeadIndex: number;  // 何番目の entry head 由来か（1始まり）
  isHeadStart:   boolean;  // その head 系列の先頭か
  freeInput:     boolean;  // freeInput プロンプトか
};

export type EntryHeadInfo = {
  id:            string;
  label:         string;
  sortOrder:     number;
  entryHeadIndex: number;
  /** この head を参照している種別（QR target / QR response / freeInputNext / next）。 */
  referrerKinds: ReferrerKind[];
  /** QR/自由入力応答で辿る想定なのに entry head（＝入場でも送信される二重送信候補）。 */
  reachedViaNonNext: boolean;
  /** freeInput 全停止前に走査され、入場で実際に送られたか。 */
  sentOnEntry:   boolean;
};

export type PhaseEntryPlan = {
  sendItems:            EntrySendItem[];
  heads:                EntryHeadInfo[];
  total:                number;   // 入場で実際に送られる通数
  overLimit:            boolean;  // 5通超え
  stoppedAtFreeInputId: string | null;
  multipleHeads:        boolean;
  /** entry head 間で sortOrder が重複し、送信順が createdAt/id 依存で不安定。 */
  sortOrderUnstable:    boolean;
};

function labelOf(m: { body?: string | null; message_type?: string | null }): string {
  const body = (m.body ?? "").replace(/\n/g, " ").trim();
  if (body) return body.length > 28 ? body.slice(0, 28) + "…" : body;
  return `(${m.message_type ?? "メッセージ"})`;
}

/** runtime と同じ並びで entry head をソートする（sortOrder→createdAt→id）。 */
function sortHeads<T extends EntryPlanMessage>(heads: T[]): T[] {
  return [...heads].sort((a, b) => {
    const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (so !== 0) return so;
    const ca = (a.created_at ?? "") < (b.created_at ?? "") ? -1 : (a.created_at ?? "") > (b.created_at ?? "") ? 1 : 0;
    if (ca !== 0) return ca;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * フェーズ入場時の送信計画を算出する。
 * @param phaseMessages 当該フェーズの active メッセージ
 * @param allMessages   逆参照判定用（QR/freeInputNext 参照元）。省略時は phaseMessages を使う。
 */
export function computePhaseEntryPlan(
  phaseMessages: EntryPlanMessage[],
  allMessages?: RefMessage[],
): PhaseEntryPlan {
  const refSource = (allMessages ?? (phaseMessages as RefMessage[]));
  const byId = new Map(phaseMessages.map((m) => [m.id, m]));
  const continuationIds = new Set(phaseMessages.map((m) => m.next_message_id).filter((x): x is string => !!x));
  const heads = sortHeads(phaseMessages.filter((m) => !continuationIds.has(m.id)));

  const sendItems: EntrySendItem[] = [];
  const headInfos: EntryHeadInfo[] = [];
  let stoppedAtFreeInputId: string | null = null;
  let globalStop = false;
  let idx = 0;

  heads.forEach((head, hi) => {
    const referrerKinds = Array.from(new Set(findReferrers(head.id, refSource).map((r) => r.kind)));
    const reachedViaNonNext = referrerKinds.some((k) => k === "qr_target" || k === "qr_response" || k === "freeInputNext");
    const sentOnEntry = !globalStop;
    headInfos.push({ id: head.id, label: labelOf(head), sortOrder: head.sort_order ?? 0, entryHeadIndex: hi + 1, referrerKinds, reachedViaNonNext, sentOnEntry });
    if (globalStop) return;

    let cur: EntryPlanMessage | undefined = head;
    const seen = new Set<string>([head.id]);
    let n = 0;
    let isStart = true;
    while (cur && n < PHASE_ENTRY_REPLY_MAX) {
      idx++; n++;
      sendItems.push({ index: idx, messageId: cur.id, label: labelOf(cur), entryHeadIndex: hi + 1, isHeadStart: isStart, freeInput: !!cur.free_input_enabled });
      isStart = false;
      if (cur.free_input_enabled) { stoppedAtFreeInputId = cur.id; globalStop = true; break; }
      const nid = cur.next_message_id;
      if (!nid || seen.has(nid) || !byId.has(nid)) break;
      seen.add(nid);
      cur = byId.get(nid);
    }
  });

  const sortVals = heads.map((h) => h.sort_order ?? 0);
  const sortOrderUnstable = heads.length > 1 && new Set(sortVals).size < sortVals.length;

  return {
    sendItems,
    heads: headInfos,
    total: sendItems.length,
    overLimit: sendItems.length > PHASE_ENTRY_REPLY_MAX,
    stoppedAtFreeInputId,
    multipleHeads: heads.length > 1,
    sortOrderUnstable,
  };
}
