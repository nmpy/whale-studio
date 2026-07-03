// src/app/oas/[id]/works/[workId]/messages/_chain-edit.ts
//
// 連続メッセージ編集（[mid]/page.tsx）を PUT /api/messages/chain へ移行するための純関数群。
// _form.tsx (.tsx・bracket route) は vitest の import 解析が苦手なため、
// テスト容易なロジックは本 .ts に置き、page/form 側から利用する。
//
// 役割:
//   - loadChainSplit: head から next chain を walk し、即時送信スロット（freeInput プロンプト含む末尾）と
//     freeInput 応答(別枠 id) に分割する。legacy（freeInputEnabled=true / next=<応答> / freeInputNext=null）も
//     応答として読み替える。
//   - buildChainSaveBody: 編集 form から PUT /api/messages/chain の body を構築する。
//   - chainErrorToMessage: API のエラーコードを編集画面バナー用の日本語へ変換する。

import {
  msgToAdditionalSlot,
  additionalSlotToMsgBody,
  type AdditionalMessageSlot,
  type MessageKindHelper,
} from "./_form-helpers";

/** chain walk に必要な API メッセージ行（msgToAdditionalSlot の入力 + chain リンク）。 */
export type ChainMsgRow = Parameters<typeof msgToAdditionalSlot>[0] & {
  id?:                         string | null;
  next_message_id?:            string | null;
  free_input_enabled?:         boolean | null;
  free_input_next_message_id?: string | null;
};

export type ChainSplit = {
  /** 2通目以降（即時送信順。freeInput プロンプトを含む場合は末尾）。 */
  sendSlots:            AdditionalMessageSlot[];
  /** 自由入力後の応答メッセージ id（別枠）。無ければ null。 */
  freeInputResponseId:  string | null;
  /** head が freeInput プロンプトの場合の応答 id（form.free_input_next_message_id 復元用）。 */
  headFreeInputResponseId: string | null;
  /** ロード時点の既存 sendSlot id 列（削除判定の基準。応答は含めない）。 */
  initialSendSlotIds:   string[];
};

const SEND_CHAIN_WALK_CAP = 12;

/** API 行から「即時送信の応答 id」を解決する（freeInputNext 優先・legacy は next で代替）。 */
function resolveResponseId(row: ChainMsgRow): string | null {
  if (row.free_input_next_message_id) return row.free_input_next_message_id;
  // legacy: freeInputEnabled=true / freeInputNext=null / next=<応答> → next を応答とみなす
  if (row.next_message_id) return row.next_message_id;
  return null;
}

/**
 * head から next chain を walk し、即時送信スロットと freeInput 応答を分割する。
 * - 最初の free_input_enabled に達したら、それを含めて停止（以降は応答＝別枠）。
 * - head 自体が freeInput プロンプトなら sendSlots は空。
 */
export function loadChainSplit(head: ChainMsgRow, allMessages: ChainMsgRow[]): ChainSplit {
  const byId = new Map<string, ChainMsgRow>();
  for (const m of allMessages) if (m.id) byId.set(m.id, m);

  // head 自体が freeInput プロンプト
  if (head.free_input_enabled) {
    const responseId = resolveResponseId(head);
    return { sendSlots: [], freeInputResponseId: responseId, headFreeInputResponseId: responseId, initialSendSlotIds: [] };
  }

  const sendSlots: AdditionalMessageSlot[] = [];
  const initialSendSlotIds: string[] = [];
  let freeInputResponseId: string | null = null;

  let currentId: string | null = head.next_message_id ?? null;
  const seen = new Set<string>();
  for (let i = 0; i < SEND_CHAIN_WALK_CAP && currentId; i++) {
    if (seen.has(currentId)) break; // 循環防止
    seen.add(currentId);
    const row = byId.get(currentId);
    if (!row) break; // 別 work / 削除済み
    const slot = msgToAdditionalSlot(row);
    if (row.id) initialSendSlotIds.push(row.id);

    if (row.free_input_enabled) {
      // この slot が freeInput プロンプト → 応答を別枠へ。slot は末尾として含める。
      freeInputResponseId = resolveResponseId(row);
      // legacy（freeInputNext=null/next=応答）でも form の select に応答が出るよう上書き。
      slot.free_input_next_message_id = freeInputResponseId ?? "";
      sendSlots.push(slot);
      break;
    }
    sendSlots.push(slot);
    currentId = row.next_message_id ?? null;
  }

  return { sendSlots, freeInputResponseId, headFreeInputResponseId: null, initialSendSlotIds };
}

// ── 保存 body 構築 ───────────────────────────────────────────

export type BuildChainBodyArgs = {
  workId:                     string;
  headId:                     string;
  expectedHeadUpdatedAt?:     string | null;
  /** formStateToMsgBody(form) の結果（head 内容）。next/freeInputNext は API 側で制御するため無視される。 */
  headBody:                   Record<string, unknown>;
  headFreeInputEnabled:       boolean;
  /** head が freeInput プロンプトの場合の応答 id（form.free_input_next_message_id）。 */
  headFreeInputNextMessageId: string;
  /** 2通目以降（即時送信スロット）。 */
  sendSlots:                  AdditionalMessageSlot[];
  /** additionalSlotToMsgBody 用の main コンテキスト。 */
  slotMain: {
    work_id:      string;
    phase_id:     string | null;
    character_id: string | null;
    kind:         Exclude<MessageKindHelper, "global">;
    sort_order:   number;
    is_active:    boolean;
  };
  /** ロード時点の既存 sendSlot id 列（削除判定の基準）。 */
  initialSendSlotIds:         string[];
  /** chain から外す（実体は残し nextMessageId=null）既存メッセージ id（#6-4c）。 */
  detachedMessageIds?:        string[];
};

export type ChainSaveBodyShape = {
  work_id: string;
  head_id: string;
  expected_head_updated_at?: string | null;
  head: Record<string, unknown>;
  slots: (Record<string, unknown> & { id?: string })[];
  free_input_response_id: string | null;
  removed_message_ids: string[];
  detached_message_ids: string[];
};

/**
 * ブロック全体(head + sendSlots)の auto_transition_phase_id を1つに解決する（読み戻し用）。
 * UI はブロック全体で1つだけ。保存時は末尾に正規化するため、読み戻しも「末尾優先」。
 * 複数メッセージに値があれば conflict=true（UI は末尾優先で採用し、次回保存で末尾へ正規化される）。
 */
export function resolveBlockAutoTransitionPhaseId(
  headValue: string | null | undefined,
  sendSlots: AdditionalMessageSlot[],
): { value: string; conflict: boolean } {
  const all = [headValue ?? "", ...sendSlots.map((s) => s.auto_transition_phase_id ?? "")]
    .map((v) => v.trim())
    .filter(Boolean);
  const uniq = Array.from(new Set(all));
  if (uniq.length === 0) return { value: "", conflict: false };
  // 末尾メッセージ = sendSlots があれば末尾 slot、無ければ head。
  const tail = sendSlots.length > 0
    ? (sendSlots[sendSlots.length - 1].auto_transition_phase_id ?? "").trim()
    : (headValue ?? "").trim();
  // 末尾に値があれば末尾優先。無ければ（途中のみに値がある既存データ）最後に見つかった値。
  const value = tail || uniq[uniq.length - 1];
  return { value, conflict: uniq.length > 1 };
}

/** 編集 form から PUT /api/messages/chain の body を構築する。 */
export function buildChainSaveBody(args: BuildChainBodyArgs): ChainSaveBodyShape {
  const norm = (s: string | null | undefined): string | null => (s && s.trim() ? s : null);

  const slots = args.sendSlots.map((s) => {
    const body = additionalSlotToMsgBody(s, args.slotMain) as Record<string, unknown>;
    return s.existingId ? { ...body, id: s.existingId } : body;
  });

  // ── 送信後の silent 自動フェーズ遷移をチェーン末尾へ正規化 ──
  // UI はブロック全体で1つ（head の auto_transition_phase_id 経由で渡る）。保存時は
  // 「メッセージ群をすべて送り終わった直後」に発火させるため、末尾メッセージにのみ値を寄せ、
  // head / 途中スロットは null にする（途中送信で発火しないため）。空（移動しない）は全 null。
  // これにより既存データで途中に値が残っていても、保存時に末尾へ正規化 / 解除時に全クリアされる。
  const autoV = norm(args.headBody.auto_transition_phase_id as string | null | undefined);
  const headBody: Record<string, unknown> = { ...args.headBody };
  if (slots.length > 0) {
    headBody.auto_transition_phase_id = null;
    slots.forEach((b, i) => { b.auto_transition_phase_id = i === slots.length - 1 ? autoV : null; });
  } else {
    headBody.auto_transition_phase_id = autoV;
  }

  // freeInput 応答 id: head が prompt なら head の next、そうでなければ prompt slot の next。
  let freeInputResponseId: string | null;
  if (args.headFreeInputEnabled) {
    freeInputResponseId = norm(args.headFreeInputNextMessageId);
  } else {
    const promptSlot = args.sendSlots.find((s) => s.free_input_enabled);
    freeInputResponseId = promptSlot ? norm(promptSlot.free_input_next_message_id) : null;
  }

  // 切り離し（detach）: 実体は残すので removed には入れない。
  const detachedMessageIds = args.detachedMessageIds ?? [];
  const detachedSet = new Set(detachedMessageIds);

  // 削除: ロード時にあった sendSlot のうち、現在の sendSlot にも detach にも無い既存 id。
  const currentIds = new Set(args.sendSlots.map((s) => s.existingId).filter((id): id is string => !!id));
  const removed_message_ids = args.initialSendSlotIds.filter((id) => !currentIds.has(id) && !detachedSet.has(id));

  return {
    work_id:                  args.workId,
    head_id:                  args.headId,
    expected_head_updated_at: args.expectedHeadUpdatedAt ?? null,
    head:                     headBody,
    slots,
    free_input_response_id:   freeInputResponseId,
    removed_message_ids,
    detached_message_ids:     detachedMessageIds.filter((id) => !currentIds.has(id)),
  };
}

/**
 * まとめ送信廃止方針: 新規作成では連続メッセージ（2通目以降）を作らせない。
 * isNew のとき送信スロットを空に丸める（UI でも追加不可だが、URL/state 操作で
 * 紛れ込んでも保存時に 1通目だけに丸める保存ガード）。既存編集（!isNew）は不変。
 */
export function sendSlotsForSave<T>(isNew: boolean, slots: T[]): T[] {
  return isNew ? [] : slots;
}

// ── エラーコード → 日本語 ────────────────────────────────────

const CHAIN_ERROR_JP: Record<string, string> = {
  MULTIPLE_FREE_INPUT:     "1つの連続メッセージ内に自由入力は1つまでです。自由入力後の応答は別枠に分けてください。",
  FREE_INPUT_NOT_LAST:     "自由入力は連続メッセージの末尾にのみ置けます。以降は「自由入力後の応答」に分けてください。",
  RESPONSE_WITHOUT_PROMPT: "自由入力後の応答が不正です（自由入力プロンプトがありません）。",
  RESPONSE_IN_SEND_CHAIN:  "自由入力後の応答が連続メッセージ本体に含まれています。別のメッセージを応答に指定してください。",
  DUPLICATE_MESSAGE:       "同じメッセージが連続メッセージ内で重複して使われています。",
  REMOVED_IN_CHAIN:        "削除対象が連続メッセージ／応答として使用されています。",
  DETACHED_IN_CHAIN:       "切り離し対象が連続メッセージ／応答として使用されています。",
  DETACHED_AND_REMOVED:    "同じメッセージを削除と切り離しの両方に指定できません。",
  REFERENCE_GUARD:         "参照されているため削除できません（他のメッセージ・クイックリプライ・自由入力応答から参照されています）。",
  CYCLE:                   "メッセージの参照が循環しています。",
  CONFLICT:                "他の編集と競合しました。画面を再読み込みして、最新の内容を確認してください。",
};

/** API のエラーコードを編集画面バナー用の日本語に変換する。未知コードは fallback。 */
export function chainErrorToMessage(code: string | null | undefined, fallback: string): string {
  if (code && CHAIN_ERROR_JP[code]) return CHAIN_ERROR_JP[code];
  return fallback;
}
