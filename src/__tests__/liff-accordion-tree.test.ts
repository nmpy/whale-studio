/**
 * src/__tests__/liff-accordion-tree.test.ts
 * accordion tree の読み取り純関数（モード判定・子孫数）。
 */
import { describe, it, expect } from "vitest";
import { resolveAccordionMode, countNestedBlocks } from "@/components/liff/accordion-tree";
import type { AccordionSettings, NestedLiffBlock } from "@/types";

const acc = (title: string, children: NestedLiffBlock[] = []): NestedLiffBlock => ({
  id: `acc-${title}`,
  block_type: "accordion",
  title: null,
  settings_json: { title, children } as AccordionSettings,
});
const text = (body: string): NestedLiffBlock => ({
  id: `t-${body}`,
  block_type: "free_text",
  title: null,
  settings_json: { body },
});

describe("resolveAccordionMode", () => {
  it("items 未設定・空なら children モード（既定）", () => {
    expect(resolveAccordionMode({})).toBe("children");
    expect(resolveAccordionMode({ title: "A" })).toBe("children");
    expect(resolveAccordionMode({ items: [] })).toBe("children");
    expect(resolveAccordionMode(undefined)).toBe("children");
    expect(resolveAccordionMode(null)).toBe("children");
  });

  it("全 item が空文字のみなら children モード（＝renderer の分岐と一致）", () => {
    expect(resolveAccordionMode({ items: [{ title: "", body: "" }, { title: "  " }] })).toBe("children");
  });

  it("有効 item が 1 件でもあれば items モード", () => {
    expect(resolveAccordionMode({ items: [{ title: "Q1", body: "A1" }] })).toBe("items");
    expect(resolveAccordionMode({ items: [{ body: "本文のみ" }] })).toBe("items");
  });

  it("children があっても有効 item があれば items モード（renderer が items を優先するため）", () => {
    const s: AccordionSettings = { title: "A", children: [text("x")], items: [{ title: "Q" }] };
    expect(resolveAccordionMode(s)).toBe("items");
  });
});

describe("countNestedBlocks", () => {
  it("非配列 / 空は 0", () => {
    expect(countNestedBlocks(undefined)).toBe(0);
    expect(countNestedBlocks(null)).toBe(0);
    expect(countNestedBlocks("x")).toBe(0);
    expect(countNestedBlocks([])).toBe(0);
  });

  it("フラットな children はそのまま件数", () => {
    expect(countNestedBlocks([text("a"), text("b"), text("c")])).toBe(3);
  });

  it("入れ子の accordion の中身も数える", () => {
    // A の children: [text, B(children:[text, C(children:[text])])]
    const tree = [text("説明"), acc("B", [text("b本文"), acc("C", [text("c本文")])])];
    // text + B + b本文 + C + c本文 = 5
    expect(countNestedBlocks(tree)).toBe(5);
  });

  it("children を持たない accordion は自分の 1 件だけ", () => {
    expect(countNestedBlocks([acc("空")])).toBe(1);
  });

  it("不正な要素（null / 非オブジェクト / children 非配列）でも落ちない", () => {
    const broken = [
      null,
      42,
      "str",
      { block_type: "accordion", settings_json: { children: "not-array" } },
      { block_type: "accordion" },
      text("ok"),
    ];
    // 数えるのは オブジェクトである 3 件（壊れた accordion 2 件 + text 1 件）
    expect(countNestedBlocks(broken)).toBe(3);
  });
});
