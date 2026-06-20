/**
 * src/__tests__/liff-accordion-items.test.ts
 * PR-BLK4d: アコーディオン複数項目（multi）の解決（純関数）+ additive validation。
 */
import { describe, it, expect } from "vitest";
import { resolveAccordionItems } from "@/components/liff/accordion-items";
import { validateBlockSettings } from "@/lib/validations";

describe("resolveAccordionItems", () => {
  it("undefined / 非配列 は [] （= single 表示）", () => {
    expect(resolveAccordionItems(undefined)).toEqual([]);
    expect(resolveAccordionItems(null)).toEqual([]);
    expect(resolveAccordionItems("x")).toEqual([]);
    expect(resolveAccordionItems({})).toEqual([]);
  });
  it("空配列 / 全 item 空 は []", () => {
    expect(resolveAccordionItems([])).toEqual([]);
    expect(resolveAccordionItems([{ title: "", body: "" }, { title: "  ", body: "  " }])).toEqual([]);
  });
  it("有効 item（title か body が非空）は残す", () => {
    expect(resolveAccordionItems([{ title: "Q1", body: "A1" }])).toEqual([{ title: "Q1", body: "A1" }]);
    expect(resolveAccordionItems([{ title: "見出しのみ" }])).toEqual([{ title: "見出しのみ", body: "" }]);
    expect(resolveAccordionItems([{ body: "本文のみ" }])).toEqual([{ title: "", body: "本文のみ" }]);
  });
  it("空 item は除外し、有効 item のみ返す（順序維持）", () => {
    expect(resolveAccordionItems([{ title: "A" }, { title: "", body: "" }, { body: "B" }]))
      .toEqual([{ title: "A", body: "" }, { title: "", body: "B" }]);
  });
  it("malformed item（null / 非object / 型違い）でクラッシュせずスキップ/正規化", () => {
    expect(resolveAccordionItems([null, 1, "s", { title: 5, body: true }, { title: "ok" }]))
      .toEqual([{ title: "ok", body: "" }]);
  });
});

describe("accordion settings validation（items は additive・任意）", () => {
  it("既存 single settings（items なし）が通る（後方互換）", () => {
    expect(validateBlockSettings("accordion", { title: "T", default_open: false, variant: "default", children: [] }).success).toBe(true);
    expect(validateBlockSettings("accordion", {}).success).toBe(true);
  });
  it("items を受理（title/body 任意）", () => {
    expect(validateBlockSettings("accordion", { items: [{ title: "Q", body: "A" }] }).success).toBe(true);
    expect(validateBlockSettings("accordion", { items: [{ title: "T" }, { body: "B" }, {}] }).success).toBe(true);
  });
  it("items は最大20件まで", () => {
    const ok = Array.from({ length: 20 }, (_, i) => ({ title: `t${i}` }));
    const ng = Array.from({ length: 21 }, (_, i) => ({ title: `t${i}` }));
    expect(validateBlockSettings("accordion", { items: ok }).success).toBe(true);
    expect(validateBlockSettings("accordion", { items: ng }).success).toBe(false);
  });
  it("item body が max1000 を超えると reject", () => {
    expect(validateBlockSettings("accordion", { items: [{ body: "a".repeat(1001) }] }).success).toBe(false);
    expect(validateBlockSettings("accordion", { items: [{ body: "a".repeat(1000) }] }).success).toBe(true);
  });
});
