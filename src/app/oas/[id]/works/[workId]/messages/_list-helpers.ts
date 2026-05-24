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
