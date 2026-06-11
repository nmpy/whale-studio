// src/lib/chain-plan.ts
//
// 連続メッセージ chain 一括保存（PUT /api/messages/chain）の「計画＋検証」純関数。
// API はこの結果に従って prisma.$transaction で更新する（new slot の id 解決は API 側）。
//
// 仕様（#6-2a）:
//   - 即時送信 = head + sendSlots。freeInput プロンプトは send chain の「末尾のみ」許可（途中不可）。
//   - 自由入力は 1 chain に 1 つまで（複数は拒否）。
//   - freeInput プロンプトは保存時に正規化: nextMessageId=null / freeInputNextMessageId=<応答 or null>。
//   - freeInputResponse は send chain と別。null 許容（freeInput受付のみ・応答なし）。
//   - 削除対象が「この chain 外」から参照(next/freeInputNext/QR target)されていれば拒否。
//   - send chain 内の id 重複・応答が send chain に含まれる・循環 は拒否。
//   - 5通超えは拒否しない（sendCount / exceedsReplyLimit を返す）。

export const LINE_REPLY_LIMIT = 5;

export type ChainSlotSpec = {
  /** 既存メッセージ = id あり（update）/ なし = 新規（create） */
  id?:                string | null;
  freeInputEnabled?:  boolean | null;
};

export type ChainSaveSpec = {
  headId:                 string;
  headFreeInputEnabled?:  boolean | null;
  /** 2通目以降（即時送信順）。freeInput は末尾のみ。 */
  sendSlots:              ChainSlotSpec[];
  /** 自由入力後の応答メッセージ id（freeInputNextMessageId に設定）。null 許容。 */
  freeInputResponseId?:   string | null;
  /** 削除するメッセージ id（実体削除。参照ガード対象）。 */
  removedMessageIds?:     string[];
  /** chain から外すメッセージ id（実体は残し nextMessageId=null。非破壊・参照ガード対象外）。 */
  detachedMessageIds?:    string[];
};

export type WorkMessageRef = {
  id:                      string;
  nextMessageId?:          string | null;
  freeInputNextMessageId?: string | null;
  /** quickReplies JSON 文字列（target_message_id 参照チェック用） */
  quickReplies?:           string | null;
};

export type ChainPlanCode =
  | "MULTIPLE_FREE_INPUT"
  | "FREE_INPUT_NOT_LAST"
  | "RESPONSE_WITHOUT_PROMPT"
  | "RESPONSE_IN_SEND_CHAIN"
  | "DUPLICATE_MESSAGE"
  | "REMOVED_IN_CHAIN"
  | "DETACHED_IN_CHAIN"
  | "DETACHED_AND_REMOVED"
  | "REFERENCE_GUARD"
  | "CYCLE";

export type ChainPlanResult =
  | {
      ok: true;
      /** send chain（head=0, slot=1..）内の freeInput プロンプト位置。無ければ null */
      freeInputAt:         number | null;
      freeInputResponseId: string | null;
      removedMessageIds:   string[];
      /** chain から外す（nextMessageId=null・非破壊）id 群。 */
      detachedMessageIds:  string[];
      /** 即時送信通数（head + sendSlots） */
      sendCount:           number;
      exceedsReplyLimit:   boolean;
    }
  | { ok: false; code: ChainPlanCode; message: string; detail?: unknown };

/** quickReplies JSON から target_message_id の集合を返す。 */
function qrTargets(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((i: { target_message_id?: string }) => i?.target_message_id).filter((x): x is string => !!x);
  } catch {
    return [];
  }
}

export function planChainSave(spec: ChainSaveSpec, work: WorkMessageRef[]): ChainPlanResult {
  const sendSlots = spec.sendSlots ?? [];
  const removedMessageIds = spec.removedMessageIds ?? [];
  const detachedMessageIds = spec.detachedMessageIds ?? [];
  const responseId = spec.freeInputResponseId ?? null;

  // send chain の freeInput フラグ列（head 含む）
  const freeFlags: boolean[] = [!!spec.headFreeInputEnabled, ...sendSlots.map((s) => !!s.freeInputEnabled)];
  const freeIdxs = freeFlags.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);

  if (freeIdxs.length > 1) {
    return { ok: false, code: "MULTIPLE_FREE_INPUT", message: "1つの連続メッセージ内に自由入力は1つまでです。" };
  }
  const freeInputAt = freeIdxs.length === 1 ? freeIdxs[0] : null;
  if (freeInputAt !== null && freeInputAt !== freeFlags.length - 1) {
    return { ok: false, code: "FREE_INPUT_NOT_LAST", message: "自由入力プロンプトは連続メッセージの末尾にのみ置けます（以降は自由入力後の応答として分離してください）。" };
  }
  if (responseId && freeInputAt === null) {
    return { ok: false, code: "RESPONSE_WITHOUT_PROMPT", message: "自由入力後の応答が指定されていますが、自由入力プロンプトがありません。" };
  }

  // send chain 内の既存 id（new slot は id なし）
  const sendChainIds: string[] = [spec.headId, ...sendSlots.map((s) => s.id).filter((id): id is string => !!id)];

  // 重複（同一 message を複数箇所で使用）
  const seen = new Set<string>();
  for (const id of sendChainIds) {
    if (seen.has(id)) return { ok: false, code: "DUPLICATE_MESSAGE", message: "同じメッセージが連続メッセージ内で重複して使われています。", detail: id };
    seen.add(id);
  }

  // 応答が send chain に含まれる（循環/二重送信）
  if (responseId && sendChainIds.includes(responseId)) {
    return { ok: false, code: "RESPONSE_IN_SEND_CHAIN", message: "自由入力後の応答が連続メッセージ本体に含まれています。" };
  }
  // 削除対象が chain 本体/応答に含まれる
  for (const id of removedMessageIds) {
    if (sendChainIds.includes(id) || id === responseId) {
      return { ok: false, code: "REMOVED_IN_CHAIN", message: "削除対象が連続メッセージ/応答として使用されています。", detail: id };
    }
  }
  // 切り離し対象（detach）の検証: send chain / 応答に含めない・削除と重複させない。
  // detach は非破壊（実体を残し nextMessageId=null）なので参照ガードは掛けない。
  const removedSet = new Set(removedMessageIds);
  for (const id of detachedMessageIds) {
    if (sendChainIds.includes(id) || id === responseId) {
      return { ok: false, code: "DETACHED_IN_CHAIN", message: "切り離し対象が連続メッセージ/応答として使用されています。", detail: id };
    }
    if (removedSet.has(id)) {
      return { ok: false, code: "DETACHED_AND_REMOVED", message: "同じメッセージを削除と切り離しの両方に指定できません。", detail: id };
    }
  }

  // 参照ガード: 削除対象が「この chain 外」から next/freeInputNext/QR target で参照されていないか
  const chainSet = new Set<string>([...sendChainIds, ...(responseId ? [responseId] : []), ...removedMessageIds]);
  for (const rid of removedMessageIds) {
    for (const m of work) {
      if (chainSet.has(m.id)) continue; // chain 内からの参照は再リンクで解消されるため除外
      const refs = [m.nextMessageId, m.freeInputNextMessageId, ...qrTargets(m.quickReplies)];
      if (refs.includes(rid)) {
        return { ok: false, code: "REFERENCE_GUARD", message: "削除対象のメッセージが他のメッセージ/QR/自由入力応答から参照されているため削除できません。", detail: { removed: rid, referencedBy: m.id } };
      }
    }
  }

  // 循環チェック: 保存後の send chain（linear・末尾 next=null）+ 応答は別枝なので、
  // sendChainIds の重複が無ければ循環しない（重複は上で検出済み）。念のため明示。
  // （応答側の chain は本 API では書き換えないため対象外）

  const sendCount = 1 + sendSlots.length;
  return {
    ok: true,
    freeInputAt,
    freeInputResponseId: responseId,
    removedMessageIds,
    detachedMessageIds,
    sendCount,
    exceedsReplyLimit: sendCount > LINE_REPLY_LIMIT,
  };
}
