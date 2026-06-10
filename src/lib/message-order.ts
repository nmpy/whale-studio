// src/lib/message-order.ts
//
// メッセージ送信順の決定論的ソート。
// DB 取得時は orderBy [sortOrder, createdAt, id] で安定化しているが、
// 配信直前の防御や、複数ソースをマージするときの最終正規化にも使えるよう純関数で提供する。
//
// 並び順: sortOrder 昇順 → createdAt 昇順 → id 昇順（すべて同値でも安定）。
// sortOrder が null/undefined の古いデータは末尾側（MAX）に寄せたうえで createdAt → id で安定化する。

export type OrderableRecord = {
  id: string;
  sortOrder?: number | null;
  createdAt?: Date | string | number | null;
};

/** Array.prototype.sort 用コンパレータ。 */
export function compareDeliveryOrder(a: OrderableRecord, b: OrderableRecord): number {
  const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;

  const ac = a.createdAt != null ? new Date(a.createdAt).getTime() : 0;
  const bc = b.createdAt != null ? new Date(b.createdAt).getTime() : 0;
  if (ac !== bc) return ac - bc;

  return String(a.id).localeCompare(String(b.id));
}

/** 配信順に安定ソートした新しい配列を返す（元配列は変更しない）。 */
export function sortRecordsForDelivery<T extends OrderableRecord>(records: readonly T[]): T[] {
  return [...records].sort(compareDeliveryOrder);
}
