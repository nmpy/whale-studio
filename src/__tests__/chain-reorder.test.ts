// src/__tests__/chain-reorder.test.ts
// 連続メッセージ（2通目以降）の並び替え・中間挿入の純関数（#6-3）。
import { describe, it, expect } from "vitest";
import {
  getFreeInputIndex, hasFreeInputSlot, canMove, moveSlot,
  canInsertAt, insertSlotAt, appendIndex, appendSlot,
} from "@/app/oas/[id]/works/[workId]/messages/_chain-reorder";

// テスト用スロット（id で順序を識別。free=freeInput プロンプト）。
type S = { id: string; free_input_enabled?: boolean };
const s = (id: string, free = false): S => ({ id, free_input_enabled: free });
const ids = (arr: S[]) => arr.map((x) => x.id);

describe("getFreeInputIndex / hasFreeInputSlot", () => {
  it("freeInput なし", () => {
    const arr = [s("a"), s("b")];
    expect(getFreeInputIndex(arr)).toBe(-1);
    expect(hasFreeInputSlot(arr)).toBe(false);
  });
  it("freeInput あり（最初の位置）", () => {
    const arr = [s("a"), s("b", true)];
    expect(getFreeInputIndex(arr)).toBe(1);
    expect(hasFreeInputSlot(arr)).toBe(true);
  });
});

describe("moveSlot / canMove", () => {
  it("上に移動できる", () => {
    const arr = [s("a"), s("b"), s("c")];
    expect(canMove(arr, 1, "up")).toBe(true);
    expect(ids(moveSlot(arr, 1, "up"))).toEqual(["b", "a", "c"]);
  });
  it("下に移動できる", () => {
    const arr = [s("a"), s("b"), s("c")];
    expect(canMove(arr, 1, "down")).toBe(true);
    expect(ids(moveSlot(arr, 1, "down"))).toEqual(["a", "c", "b"]);
  });
  it("先頭の上移動は no-op", () => {
    const arr = [s("a"), s("b")];
    expect(canMove(arr, 0, "up")).toBe(false);
    expect(ids(moveSlot(arr, 0, "up"))).toEqual(["a", "b"]);
  });
  it("末尾の下移動は no-op", () => {
    const arr = [s("a"), s("b")];
    expect(canMove(arr, 1, "down")).toBe(false);
    expect(ids(moveSlot(arr, 1, "down"))).toEqual(["a", "b"]);
  });
  it("freeInput は下へ移動できない（末尾固定）", () => {
    const arr = [s("a"), s("b", true)];
    expect(canMove(arr, 1, "down")).toBe(false);
    // 上にも動かせない（freeInput は固定）
    expect(canMove(arr, 1, "up")).toBe(false);
    expect(ids(moveSlot(arr, 1, "up"))).toEqual(["a", "b"]);
  });
  it("通常スロットを freeInput より下へ移動できない", () => {
    const arr = [s("a"), s("b", true)];
    // a を下げると freeInput より下に行く → 不可
    expect(canMove(arr, 0, "down")).toBe(false);
    expect(ids(moveSlot(arr, 0, "down"))).toEqual(["a", "b"]);
  });
  it("freeInput が末尾にある複数スロットでも通常同士は入れ替え可", () => {
    const arr = [s("a"), s("b"), s("c", true)];
    expect(ids(moveSlot(arr, 0, "down"))).toEqual(["b", "a", "c"]); // a↔b OK
    expect(canMove(arr, 1, "down")).toBe(false);                    // b を c(freeInput) の下へは不可
  });
});

describe("canInsertAt / insertSlotAt", () => {
  it("freeInput なし: 先頭〜末尾どこにも挿入できる", () => {
    const arr = [s("a"), s("b")];
    expect(canInsertAt(arr, 0)).toBe(true);
    expect(canInsertAt(arr, 2)).toBe(true);
    expect(ids(insertSlotAt(arr, 1, s("x")))).toEqual(["a", "x", "b"]);
  });
  it("freeInput より上には挿入できる", () => {
    const arr = [s("a"), s("b", true)];
    expect(canInsertAt(arr, 1)).toBe(true); // freeInput の直前
    expect(ids(insertSlotAt(arr, 1, s("x")))).toEqual(["a", "x", "b"]);
  });
  it("freeInput より下には挿入できない", () => {
    const arr = [s("a"), s("b", true)];
    expect(canInsertAt(arr, 2)).toBe(false); // freeInput の後ろ
    expect(ids(insertSlotAt(arr, 2, s("x")))).toEqual(["a", "b"]); // no-op
  });
});

describe("appendSlot / appendIndex（末尾追加）", () => {
  it("freeInput がない状態の末尾追加は最後に入る", () => {
    const arr = [s("a"), s("b")];
    expect(appendIndex(arr)).toBe(2);
    expect(ids(appendSlot(arr, s("x")))).toEqual(["a", "b", "x"]);
  });
  it("freeInput がある状態の末尾追加は freeInput 直前に入る", () => {
    const arr = [s("a"), s("b", true)];
    expect(appendIndex(arr)).toBe(1);
    expect(ids(appendSlot(arr, s("x")))).toEqual(["a", "x", "b"]); // freeInput は末尾のまま
  });
});
