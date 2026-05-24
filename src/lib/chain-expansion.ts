// src/lib/chain-expansion.ts
//
// メッセージ配列内に含まれる next_message_id チェーンを認識し、
// head から順に並べ替えるための共通 helper。
//
// 用途:
//   - buildPhaseMessages (= phase.messages を chain head 順に展開)
//   - buildKeywordMessages (= keyword 応答 + chain 継続を 1 つの連続発話として返す)
//   - その他、LINE 送信前に「DB から取得済みの配列」を chain 順に並べたい箇所
//
// 設計方針:
//   - 配列内で完結する (= 配列に存在しない継続メッセージは DB から fetch しない)。
//     fetch が必要なケースは別途 buildMessageChain (webhook 側) を併用。
//   - field 名は呼び出し側で normalize する (= snake_case / camelCase 両対応)。
//   - 上限 5 件 (= LINE 返信上限) で打ち切り、循環参照を防ぐ。
//   - 配列内で到達できないレコードは安全側で末尾に append (= 切れたチェーンを失わない)。

/** array 内の next_message_id チェーンを head から順に並べ替える。
 *  @param records 入力配列
 *  @param getNextId records[i].next_message_id を返す callback (field 名は呼び出し側で吸収)
 *  @param maxChain 1 chain あたりの最大件数。LINE 返信上限 (5) に合わせる
 *  @returns chain head から順に並んだ配列。継続メッセージ (= 他から指されているもの)
 *           は head の直後に並び、独立 1 行としては並ばない。 */
export function expandChainsInArray<T extends { id: string }>(
  records: T[],
  getNextId: (r: T) => string | null | undefined,
  maxChain = 5,
): T[] {
  if (records.length <= 1) return records.slice();

  const byId = new Map<string, T>();
  for (const r of records) byId.set(r.id, r);

  // 「他レコードの next_message_id が指している ID 群」を集める = chain 継続側
  const continuationIds = new Set<string>();
  for (const r of records) {
    const nextId = getNextId(r);
    if (nextId && byId.has(nextId)) continuationIds.add(nextId);
  }

  const result: T[] = [];
  const seen = new Set<string>();

  // 入力順に走査。chain 継続は skip し、head のみを起点に chain walk する。
  // 入力順を尊重するため (= sort_order が呼び出し側で決まっている)、
  // head の登場順 = result 上の登場順 になる。
  for (const r of records) {
    if (continuationIds.has(r.id)) continue;   // chain 継続は head 側から到達する
    if (seen.has(r.id)) continue;

    let current: T | undefined = r;
    let depth = 0;
    while (current && depth < maxChain) {
      if (seen.has(current.id)) break;
      seen.add(current.id);
      result.push(current);
      depth++;
      const nextId = getNextId(current);
      if (!nextId) break;
      current = byId.get(nextId);
    }
  }

  // 配列内で到達できなかった records (= disconnected, 通常はないが安全側)
  for (const r of records) {
    if (!seen.has(r.id)) result.push(r);
  }

  return result;
}

/** LineMessage 配列の quickReply を chain tail (= 最後のメッセージ) に集約する。
 *  LINE 仕様: 1 通の reply 内で quickReply は最後のメッセージにのみ表示される。
 *  中間メッセージに設定されていたら最後に移動する。
 *  既に最後にあればそのまま。
 *
 *  注意: in-place で変更する (= 渡された配列のオブジェクトを直接書き換える)。 */
export function moveQuickReplyToTail<T extends { quickReply?: unknown }>(messages: T[]): void {
  if (messages.length <= 1) return;
  const last = messages[messages.length - 1];
  if (last.quickReply !== undefined) return;  // 既に末尾にある

  // 末尾から手前へ走査して最初に見つかった quickReply を末尾へ移動
  for (let i = messages.length - 2; i >= 0; i--) {
    const m = messages[i];
    if (m.quickReply !== undefined) {
      last.quickReply = m.quickReply;
      m.quickReply = undefined;
      return;
    }
  }
}
