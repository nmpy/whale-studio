// src/app/oas/[id]/works/[workId]/messages/_chain-reorder.ts
//
// 連続メッセージ（2通目以降 = additionalMessages）の並び替え・中間挿入の純関数群（#6-3）。
// UI（_form.tsx）はこれらを呼ぶだけにし、不変条件をここに集約する。
//
// 不変条件:
//   - head（1通目）は対象外（並び替えは sendSlots = 2通目以降のみ）。
//   - freeInput プロンプトのスロットは送信 chain の「末尾固定（ピン留め）」。
//     → freeInput スロットは移動不可 / freeInput より下へは挿入・移動できない。
//     （runtime は freeInput で即時送信を停止し、API も FREE_INPUT_NOT_LAST を 422 で拒否するため）
//
// 保存は #6-2 の経路をそのまま使う（buildChainSaveBody が配列順を nextMessageId で再リンク）。

export type ReorderSlot = { free_input_enabled?: boolean | null };
export type MoveDir = "up" | "down";

/** 最初の freeInput プロンプトの index。無ければ -1。 */
export function getFreeInputIndex<T extends ReorderSlot>(slots: T[]): number {
  return slots.findIndex((s) => !!s.free_input_enabled);
}

/** freeInput プロンプトを含むか。 */
export function hasFreeInputSlot<T extends ReorderSlot>(slots: T[]): boolean {
  return getFreeInputIndex(slots) >= 0;
}

/** index のスロットを dir 方向へ動かせるか。 */
export function canMove<T extends ReorderSlot>(slots: T[], index: number, dir: MoveDir): boolean {
  if (index < 0 || index >= slots.length) return false;
  // freeInput プロンプトは末尾固定 → 移動不可。
  if (slots[index].free_input_enabled) return false;
  if (dir === "up") {
    return index > 0;
  }
  // down: 末尾不可 + 直下が freeInput なら不可（freeInput より下へ行けない）。
  if (index >= slots.length - 1) return false;
  if (slots[index + 1].free_input_enabled) return false;
  return true;
}

/** index のスロットを dir 方向へ移動した新配列を返す。動かせなければ元配列をそのまま返す。 */
export function moveSlot<T extends ReorderSlot>(slots: T[], index: number, dir: MoveDir): T[] {
  if (!canMove(slots, index, dir)) return slots;
  const target = dir === "up" ? index - 1 : index + 1;
  const next = slots.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * 挿入位置 index（= その index の手前に挿入）が許可されるか。
 * freeInput があれば freeInput の手前まで（freeInputIndex 以下）。無ければ末尾まで。
 */
export function canInsertAt<T extends ReorderSlot>(slots: T[], index: number): boolean {
  if (index < 0) return false;
  const fi = getFreeInputIndex(slots);
  const max = fi >= 0 ? fi : slots.length;
  return index <= max;
}

/** index の手前に slot を挿入した新配列を返す。挿入不可なら元配列をそのまま返す。 */
export function insertSlotAt<T extends ReorderSlot>(slots: T[], index: number, slot: T): T[] {
  if (!canInsertAt(slots, index)) return slots;
  const next = slots.slice();
  next.splice(index, 0, slot);
  return next;
}

/** 末尾追加の挿入位置。freeInput があればその直前、無ければ末尾。 */
export function appendIndex<T extends ReorderSlot>(slots: T[]): number {
  const fi = getFreeInputIndex(slots);
  return fi >= 0 ? fi : slots.length;
}

/** 末尾に slot を追加した新配列。freeInput があればその直前に入れる（freeInput は末尾固定）。 */
export function appendSlot<T extends ReorderSlot>(slots: T[], slot: T): T[] {
  return insertSlotAt(slots, appendIndex(slots), slot);
}
