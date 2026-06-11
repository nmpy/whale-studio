// src/app/oas/[id]/works/[workId]/messages/_chain-import.ts
//
// 「既存メッセージを chain に取り込む」(#6-4d 相当・PR3a) の純関数群。UI 非接続。
//
// 取り込み = standalone な entry head（＋その next 継続ブロック）を target chain の sendSlot として
// 連結する操作。保存は既存 PUT /api/messages/chain（#6-2a transaction）を使うため、ここでは
// 「候補抽出」「ブロック抽出」「取り込み可否＋警告」の判定だけを行う（DB write しない）。
//
// 安全制約（承認済み）:
//   - 候補は 同一 work / active / next 非参照(entry head) / target chain 外 / target head 以外。
//   - 他 chain 途中（next 参照あり）の message は取り込み不可（先に #6-4c detach が必要）。
//   - 取り込み単位 = 選択 message + その next 継続ブロック（freeInput プロンプトで停止・freeInputNext 先は含めない）。
//   - freeInput を含むブロックは target chain の末尾にのみ挿入可。
//   - target chain と重複する message を含むブロックは拒否（循環防止）。

import { findReferrers, type ReferrerKind, type RefMessage } from "@/lib/message-refs";

export const IMPORT_REPLY_MAX = 5;
const BLOCK_WALK_CAP = 20;

export type ImportMessage = {
  id:                          string;
  workId?:                     string | null;
  isActive?:                   boolean | null;
  body?:                       string | null;
  message_type?:               string | null;
  next_message_id?:            string | null;
  free_input_enabled?:         boolean | null;
  free_input_next_message_id?: string | null;
  quick_replies?:              unknown;
};

export type ImportBlock = {
  /** 取り込むメッセージ id 列（head → next 継続。freeInput プロンプトで停止・含む）。 */
  blockIds:             string[];
  /** ブロックに freeInput プロンプトを含むか（含む場合は末尾挿入のみ可）。 */
  containsFreeInput:    boolean;
  /** freeInput プロンプトの応答 id（freeInputNext 先 or legacy next）。ブロックには含めない。 */
  freeInputResponseId:  string | null;
  length:               number;
};

const labelOf = (m?: { body?: string | null; message_type?: string | null }): string => {
  const body = (m?.body ?? "").replace(/\n/g, " ").trim();
  if (body) return body.length > 28 ? body.slice(0, 28) + "…" : body;
  return `(${m?.message_type ?? "メッセージ"})`;
};

/** head から next 継続を辿り、取り込みブロックを抽出する（freeInput プロンプトで停止・含む）。 */
export function extractImportBlock(headId: string, allMessages: ImportMessage[]): ImportBlock {
  const byId = new Map(allMessages.map((m) => [m.id, m]));
  const blockIds: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = headId;
  let containsFreeInput = false;
  let freeInputResponseId: string | null = null;
  for (let i = 0; cur && i < BLOCK_WALK_CAP; i++) {
    if (seen.has(cur)) break; // 循環防止
    const m = byId.get(cur);
    if (!m) break;
    seen.add(cur);
    blockIds.push(cur);
    if (m.free_input_enabled) {
      containsFreeInput = true;
      freeInputResponseId = m.free_input_next_message_id ?? m.next_message_id ?? null; // legacy next も応答とみなす
      break; // freeInput プロンプトで停止（freeInputNext 先は含めない）
    }
    cur = m.next_message_id ?? null;
  }
  return { blockIds, containsFreeInput, freeInputResponseId, length: blockIds.length };
}

export type ImportCandidate = {
  id:               string;
  label:            string;
  chainLength:      number;
  containsFreeInput: boolean;
  /** QR/自由入力応答からも参照されている（取り込むと共有になる）→ 警告材料。 */
  qrReferenced:     boolean;
  referrerKinds:    ReferrerKind[];
};

/**
 * 取り込み候補（standalone entry head）を抽出する。
 * 候補: active / next 非参照(entry head) / target chain 外 / target head 以外 /（workId 指定時）同一 work。
 */
export function selectImportableHeads(
  allMessages: ImportMessage[],
  opts: { targetHeadId: string; targetChainIds: string[]; workId?: string | null },
): ImportCandidate[] {
  const continuationIds = new Set(allMessages.map((m) => m.next_message_id).filter((x): x is string => !!x));
  const targetSet = new Set(opts.targetChainIds);
  const refSource = allMessages as unknown as RefMessage[];
  const out: ImportCandidate[] = [];
  for (const m of allMessages) {
    if (m.isActive === false) continue;
    if (opts.workId && m.workId && m.workId !== opts.workId) continue;
    if (continuationIds.has(m.id)) continue;      // entry head のみ（next 非参照）
    if (targetSet.has(m.id)) continue;            // target chain 内は除外
    if (m.id === opts.targetHeadId) continue;
    const block = extractImportBlock(m.id, allMessages);
    const kinds = Array.from(new Set(findReferrers(m.id, refSource).map((r) => r.kind)));
    out.push({
      id: m.id,
      label: labelOf(m),
      chainLength: block.length,
      containsFreeInput: block.containsFreeInput,
      qrReferenced: kinds.some((k) => k === "qr_target" || k === "qr_response" || k === "freeInputNext"),
      referrerKinds: kinds,
    });
  }
  return out;
}

export type ImportValidationCode =
  | "NOT_FOUND" | "INACTIVE" | "CROSS_WORK" | "IS_CONTINUATION"
  | "IS_TARGET_HEAD" | "IN_TARGET_CHAIN" | "BLOCK_OVERLAPS_TARGET" | "FREE_INPUT_NOT_LAST";

export type ImportValidation =
  | { ok: true; block: ImportBlock; warnings: string[] }
  | { ok: false; code: ImportValidationCode; message: string };

/**
 * 既存メッセージ head を target chain に取り込めるか検証する（純関数・DB write なし）。
 * @param appendAtEnd target chain の末尾に挿入するか（freeInput 含むブロックは末尾のみ可）。
 * @param targetSendCount 取り込み前の target 送信通数（5通超え警告の判定用）。
 */
export function validateImport(args: {
  headId:          string;
  targetHeadId:    string;
  targetChainIds:  string[];
  appendAtEnd:     boolean;
  allMessages:     ImportMessage[];
  workId?:         string | null;
  targetSendCount?: number;
  detachedMessageIds?: string[];
  removedMessageIds?:  string[];
}): ImportValidation {
  const byId = new Map(args.allMessages.map((m) => [m.id, m]));
  const m = byId.get(args.headId);
  if (!m) return { ok: false, code: "NOT_FOUND", message: "取り込むメッセージが見つかりません。" };
  if (m.isActive === false) return { ok: false, code: "INACTIVE", message: "無効なメッセージは取り込めません。" };
  if (args.workId && m.workId && m.workId !== args.workId) return { ok: false, code: "CROSS_WORK", message: "別の作品のメッセージは取り込めません。" };

  // 判定順: 同一 chain（target head / target 内）を先に判定し、その後に「他 chain 途中」を判定する。
  if (args.headId === args.targetHeadId) return { ok: false, code: "IS_TARGET_HEAD", message: "このメッセージ自身は取り込めません。" };
  const targetSet = new Set(args.targetChainIds);
  if (targetSet.has(args.headId)) return { ok: false, code: "IN_TARGET_CHAIN", message: "すでにこの連続メッセージに含まれています。" };

  const continuationIds = new Set(args.allMessages.map((x) => x.next_message_id).filter((x): x is string => !!x));
  if (continuationIds.has(args.headId)) return { ok: false, code: "IS_CONTINUATION", message: "他の連続メッセージの途中にあるため取り込めません（先に「chainから外す」で単体化してください）。" };

  const block = extractImportBlock(args.headId, args.allMessages);
  // ブロックが target chain / detached / removed と重複 → 循環/重複の恐れ
  const conflictSet = new Set([...args.targetChainIds, ...(args.detachedMessageIds ?? []), ...(args.removedMessageIds ?? [])]);
  if (block.blockIds.some((id) => conflictSet.has(id))) {
    return { ok: false, code: "BLOCK_OVERLAPS_TARGET", message: "取り込みブロックが連続メッセージ／削除・切り離し対象と重複しています（循環防止のため拒否）。" };
  }
  if (block.containsFreeInput && !args.appendAtEnd) {
    return { ok: false, code: "FREE_INPUT_NOT_LAST", message: "自由入力を含むブロックは連続メッセージの末尾にのみ取り込めます。" };
  }

  // ── 警告（拒否はしない）──
  const warnings: string[] = [];
  const kinds = Array.from(new Set(findReferrers(args.headId, args.allMessages as unknown as RefMessage[]).map((r) => r.kind)));
  if (kinds.some((k) => k === "qr_target" || k === "qr_response" || k === "freeInputNext")) {
    warnings.push("このメッセージは QR / 自由入力応答からも参照されています。取り込むと入場 chain と QR の両方から到達される可能性があります（共有）。");
  }
  // 5通超え: freeInput を含まないブロックは送信 chain が伸び、Reply 上限(5)に触れうる。
  const baseCount = args.targetSendCount ?? args.targetChainIds.length;
  if (!block.containsFreeInput && baseCount + block.length > IMPORT_REPLY_MAX) {
    warnings.push(`取り込み後の送信が ${baseCount + block.length}通になり 5通を超えます。6通目以降は Push となり未達リスクがあります（freeInput / QR / フェーズ遷移で区切ることを推奨）。`);
  }

  return { ok: true, block, warnings };
}
