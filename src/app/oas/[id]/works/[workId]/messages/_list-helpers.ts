// src/app/oas/[id]/works/[workId]/messages/_list-helpers.ts
//
// メッセージ一覧画面の chain 関連ロジックを純関数で切り出したヘルパー。
// vitest が bracket-path の .tsx import を解析しにくいため、ロジックは本ファイルに置く。
//
// 役割:
//   - collectChainContinuationIds: 「他のメッセージから next_message_id で参照されている」
//     継続メッセージの ID 集合を作る (= 一覧から除外する対象)
//   - chainSizeFrom: 指定 ID から next_message_id を walk して合計件数を返す
//     (= 一覧に「N 通の連続メッセージ」と表示するため。LINE 上限 5 件で打ち切り)
//
// 設計方針:
//   - 純関数 (= I/O / global state なし)
//   - field 名は呼び出し側に合わせて snake_case `next_message_id` で固定
//     (= /api/messages GET レスポンスがこの形)

type MessageLike = {
  id:               string;
  next_message_id?: string | null;
};

/** 連続メッセージの「継続側」(= chain head じゃないもの) の ID Set を作る。
 *  これに含まれる ID は一覧から非表示 (= 親の塊に内包されている扱い) にする。
 *
 *  仕様: msg.next_message_id が指す ID を継続扱いとする。msg 自身は head とは限らないが、
 *  「他から指されている」という事実のみで判定する。 */
export function collectChainContinuationIds(messages: MessageLike[]): Set<string> {
  const out = new Set<string>();
  for (const m of messages) {
    if (m.next_message_id) out.add(m.next_message_id);
  }
  return out;
}

/** head から chain を walk して「2 通目以降」のメッセージ配列を返す (= head 自身は含まない)。
 *  一覧画面で chain head の下に展開表示するために使う。
 *  上限 4 件 (= LINE 上限 5 件 - head 1 件) でループ + 循環参照防止。
 *  next_message_id が配列内に存在しない ID を指していたらそこで walk を止める。
 *
 *  generic T で渡された型をそのまま返すので、呼び出し側で全プロパティ (body / character 等) が使える。 */
export function getChainContinuations<T extends MessageLike>(
  messages: T[],
  headId: string,
): T[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const out: T[] = [];
  const visited = new Set<string>([headId]);
  let currentId: string | null = byId.get(headId)?.next_message_id ?? null;
  while (currentId && !visited.has(currentId) && out.length < 4) {
    if (!byId.has(currentId)) break;
    visited.add(currentId);
    out.push(byId.get(currentId)!);
    currentId = byId.get(currentId)?.next_message_id ?? null;
  }
  return out;
}

/** Phase 2c: メッセージに何らかの演出設定が入っているかを判定する。
 *
 *  - lag_ms は「次の発話までの待機時間」。0 / null / undefined はデフォルト扱いなので「無し」とする。
 *  - 他の timing 列は null = inherit、非 null = 明示設定。よって 1 つでも非 null なら「あり」。
 *
 *  呼び出し側は MessageWithRelations の部分集合を渡す。snake_case 固定。 */
export function hasAnyTiming(m: {
  lag_ms?:               number | null;
  read_receipt_mode?:    string | null;
  read_delay_ms?:        number | null;
  typing_enabled?:       boolean | null;
  typing_min_ms?:        number | null;
  typing_max_ms?:        number | null;
  loading_enabled?:      boolean | null;
  loading_threshold_ms?: number | null;
  loading_min_seconds?:  number | null;
  loading_max_seconds?:  number | null;
}): boolean {
  if (m.lag_ms != null && m.lag_ms > 0) return true;
  if (m.read_receipt_mode != null && m.read_receipt_mode !== "inherit") return true;
  if (m.read_delay_ms != null) return true;
  if (m.typing_enabled != null) return true;
  if (m.typing_min_ms != null) return true;
  if (m.typing_max_ms != null) return true;
  if (m.loading_enabled != null) return true;
  if (m.loading_threshold_ms != null) return true;
  if (m.loading_min_seconds != null) return true;
  if (m.loading_max_seconds != null) return true;
  return false;
}

/** Phase 2c: 演出設定の簡易サマリ文字列を作る (= title 属性 / tooltip 用)。
 *  「typing」「既読遅延 N 秒」「待機 N 秒」などの設定済み項目だけを併記する。
 *  全て無設定なら空文字を返す (= hasAnyTiming と併用前提)。 */
export function summarizeTiming(m: {
  lag_ms?:               number | null;
  read_receipt_mode?:    string | null;
  read_delay_ms?:        number | null;
  typing_enabled?:       boolean | null;
  loading_enabled?:      boolean | null;
}): string {
  const parts: string[] = [];
  if (m.lag_ms != null && m.lag_ms > 0) {
    parts.push(`待機 ${(m.lag_ms / 1000).toFixed(m.lag_ms % 1000 === 0 ? 0 : 1)}秒`);
  }
  if (m.typing_enabled === true) parts.push("送信前の間");
  if (m.read_receipt_mode === "delayed") {
    const sec = m.read_delay_ms != null ? `${(m.read_delay_ms / 1000).toFixed(m.read_delay_ms % 1000 === 0 ? 0 : 1)}秒` : "";
    parts.push(`既読遅延${sec ? ` ${sec}` : ""}`);
  } else if (m.read_receipt_mode === "before_reply") {
    parts.push("既読(返信直前)");
  } else if (m.read_receipt_mode === "immediate") {
    parts.push("既読(即時)");
  }
  if (m.loading_enabled === true) parts.push("「入力中...」");
  return parts.length > 0 ? `演出: 設定あり (${parts.join(" / ")})` : "演出: 設定あり";
}

/** headId を起点に next_message_id を walk し、合計件数 (= 自分自身 + 子孫) を返す。
 *  上限 5 件 (= LINE 返信上限と一致) でループ + 循環参照防止。
 *  headId 自身が見つからない場合は 0 を返す。
 *  next_message_id が配列内に存在しない ID を指している場合はそこで walk を止める。 */
export function chainSizeFrom(messages: MessageLike[], headId: string): number {
  const byId = new Map(messages.map((m) => [m.id, m]));
  let count = 0;
  const visited = new Set<string>();
  let currentId: string | null = headId;
  while (currentId && !visited.has(currentId) && count < 5) {
    if (!byId.has(currentId)) break;
    visited.add(currentId);
    count++;
    currentId = byId.get(currentId)?.next_message_id ?? null;
  }
  return count;
}

/** LINE が 1 回の reply で送れる最大メッセージ数（line.ts と一致）。 */
export const LINE_REPLY_MAX = 5;

/** headId 起点の chain の「実際の総通数」(head 含む・**上限なし**・循環防止)。
 *  chainSizeFrom は LINE 上限 5 で打ち切るが、こちらは実長を返す。
 *  管理画面で「合計N通」「5通を超える」を正確に表示するために使う。 */
export function chainLengthFrom(messages: MessageLike[], headId: string): number {
  const byId = new Map(messages.map((m) => [m.id, m]));
  let count = 0;
  const visited = new Set<string>();
  let currentId: string | null = headId;
  while (currentId && !visited.has(currentId)) {
    if (!byId.has(currentId)) break;
    visited.add(currentId);
    count++;
    currentId = byId.get(currentId)?.next_message_id ?? null;
  }
  return count;
}

type SendBatchMessageLike = MessageLike & { free_input_enabled?: boolean | null };

/** buildPhaseMessages が「1 回の送信」で出すメッセージ総数を推定する（runtime の挙動を踏襲）。
 *  - 非 continuation の head を入力順に走査
 *  - 各 chain は最大 5 件 walk（LINE_REPLY_MAX。runtime も 1 chain を 5 で打ち切る）
 *  - free_input_enabled の message に達したら、それを含めてフェーズ全体の走査を停止
 *  返り値 > 5 のとき、6 通目以降は Reply に乗らず Push fallback になる（reply は最大 5 件）。
 *  ※ messages は表示順（sortOrder→createdAt）で渡すこと。 */
export function estimatePhaseSendBatch(messages: SendBatchMessageLike[]): number {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const continuationIds = collectChainContinuationIds(messages);
  let total = 0;
  for (const head of messages) {
    if (continuationIds.has(head.id)) continue;
    let cur: SendBatchMessageLike | undefined = head;
    const visited = new Set<string>([head.id]);
    let chainCount = 0;
    let stoppedAtFreeInput = false;
    while (cur && chainCount < LINE_REPLY_MAX) {
      chainCount++;
      total++;
      if (cur.free_input_enabled) { stoppedAtFreeInput = true; break; }
      const nextId = cur.next_message_id;
      if (!nextId || visited.has(nextId) || !byId.has(nextId)) break;
      visited.add(nextId);
      cur = byId.get(nextId);
    }
    if (stoppedAtFreeInput) break; // free_input でフェーズ全体停止
  }
  return total;
}

/** 送信単位推定で参照するメッセージ形（一覧 API の snake_case shape の部分集合）。 */
export type SendUnitMessage = {
  id:                          string;
  kind?:                       string | null;
  next_message_id?:            string | null;
  free_input_enabled?:         boolean | null;
  free_input_next_message_id?: string | null;
  trigger_keyword?:            string | null;
  quick_replies?:              { action?: string | null; target_message_id?: string | null }[] | null;
};

/** runtime の requiresUserInteraction（src/lib/runtime.ts）と同等。
 *  このノードを送信した上で連続送信を停止するか（= ユーザー操作待ち）。 */
function isWaitNode(m: SendUnitMessage): boolean {
  if (m.kind === "puzzle") return true;                                  // 謎は回答待ちで停止
  if (m.kind !== "start" && (m.trigger_keyword ?? "").trim()) return true; // キーワード入力待ち
  if ((m.quick_replies?.length ?? 0) > 0) return !m.next_message_id;       // QR は chain 末尾でのみ停止
  return false;
}

/** runtime の isAutoSendableMessageNode と同等。フェーズ入場時に自動送信される head か。 */
function isAutoSendableHead(m: SendUnitMessage, targetMsgIds: Set<string>): boolean {
  if (targetMsgIds.has(m.id)) return false;                              // QR 分岐先は入場では送らない
  if (m.kind === "response" || m.kind === "hint") return false;          // キーワード/ヒントトリガー専用
  if (m.kind !== "start" && (m.trigger_keyword ?? "").trim()) return false;
  return true;
}

/** トリガー（QR タップ / 自由入力後 / キーワード応答）の起点から、1 回の reply で
 *  連続送信される通数を数える。トリガーは既に発火済みなので起点の kind/keyword では止めず、
 *  next_message_id を walk して **次の操作待ち**で停止する:
 *    - free_input プロンプト / puzzle / QR 末尾（quick_replies かつ next_message_id なし）は含めて停止。 */
function chainUnitFrom(startId: string, byId: Map<string, SendUnitMessage>): number {
  let cur = byId.get(startId);
  const visited = new Set<string>();
  let count = 0;
  while (cur && !visited.has(cur.id) && count < 100) {
    visited.add(cur.id);
    count++;
    if (cur.free_input_enabled) break;
    if (cur.kind === "puzzle") break;
    if ((cur.quick_replies?.length ?? 0) > 0 && !cur.next_message_id) break; // QR 末尾で停止
    const nid = cur.next_message_id;
    if (!nid || !byId.has(nid)) break;
    cur = byId.get(nid);
  }
  return count;
}

/** 「実際に 1 回の送信処理（1 replyToken）で LINE に渡しうるメッセージ数」の最大値を返す。
 *
 *  runtime の送信仕様（src/lib/runtime.ts drainAutoSendableItems / src/lib/line.ts
 *  buildPhaseMessages）を踏襲して、送信単位ごとに数える:
 *    - 入場送信単位: 自動送信対象の head を sortOrder 順に連結し、最初の wait node
 *      （puzzle / QR末尾 / trigger / free_input）を含めて停止（= 入場で一度にまとめて送る分）。
 *      QR 分岐先・response/hint・keyword 待ちメッセージは入場送信から除外する。
 *    - 個別トリガー単位: QR target / free_input 後の応答(freeInputNext) / response メッセージは、
 *      それぞれ別トリガーの reply 起点なので、起点ごとに連続送信通数を数える。
 *  これらの最大値を返すことで「1 回の応答が 5 通以上か」を実送信と一致して判定できる。
 *  フェーズ総数では判定しない（途中に入力/QR/分岐/謎回答が挟まれば送信単位が区切られる）。
 *
 *  ※ messages は表示順（sortOrder→createdAt）で渡すこと（入場連結順を runtime に合わせるため）。 */
export function estimateMaxSendUnit(messages: SendUnitMessage[]): number {
  const byId = new Map(messages.map((m) => [m.id, m]));

  // QR 分岐先（target_message_id）= 入場では送らず、タップ時に送る別トリガー起点。
  const targetMsgIds = new Set<string>();
  for (const m of messages) {
    for (const qr of m.quick_replies ?? []) {
      if (qr?.target_message_id) targetMsgIds.add(qr.target_message_id);
    }
  }
  const continuationIds = collectChainContinuationIds(messages);

  // ── 入場送信単位: 自動送信 head を順に連結し、最初の wait node / free_input で全体停止 ──
  let entryCount = 0;
  const entryVisited = new Set<string>();
  let stopped = false;
  for (const head of messages) {
    if (stopped) break;
    if (continuationIds.has(head.id)) continue;          // continuation は head 経由で展開
    if (!isAutoSendableHead(head, targetMsgIds)) continue;
    let cur: SendUnitMessage | undefined = head;
    while (cur && !entryVisited.has(cur.id)) {
      if (cur.kind === "response" || cur.kind === "hint") break;
      entryVisited.add(cur.id);
      entryCount++;
      if (cur.free_input_enabled || isWaitNode(cur)) { stopped = true; break; }
      const nid = cur.next_message_id;
      if (!nid || !byId.has(nid)) break;
      cur = byId.get(nid);
    }
  }

  // ── 個別トリガー単位（QR タップ / 自由入力後 / キーワード応答）──
  const triggerHeadIds = new Set<string>(targetMsgIds);
  for (const m of messages) {
    if (m.free_input_next_message_id) triggerHeadIds.add(m.free_input_next_message_id);
    if (m.kind === "response") triggerHeadIds.add(m.id);
  }

  let max = entryCount;
  for (const id of triggerHeadIds) {
    if (!byId.has(id)) continue;
    const c = chainUnitFrom(id, byId);
    if (c > max) max = c;
  }
  return max;
}

/** 送信単位の通数 `maxUnit` に対して「連続送信が多すぎ」警告を出すべきか。
 *
 *  仕様: 1回のプレイヤー操作（QR / 入力 / クイックリプライ / 分岐 / 謎回答など）を起点に、
 *  次の操作待ちまでに送れるのは LINE Reply API の上限 = 最大 5 通まで。
 *  よって **5 通までは許容（警告なし）・6 通以上で警告** とする。
 *  per-chain の「合計N通」バッジ（chainTotal > LINE_REPLY_MAX）と同じ「>5」基準で揃える。
 *
 *  ※ 画像タップは送信単位の区切りに含めない（runtime の requiresUserInteraction が
 *    画像タップを待機点として扱わないため、estimate 側だけ区切ると実送信と乖離する）。 */
export function shouldShowSendUnitWarning(maxUnit: number, replyMax: number = LINE_REPLY_MAX): boolean {
  return maxUnit > replyMax;
}
