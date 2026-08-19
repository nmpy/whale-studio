// @vitest-environment jsdom
// src/__tests__/liff-accordion-nesting-render.test.tsx
//
// 「A > B > C が実際に入れ子で描画され、かつ見た目で階層が区別できる」ことの描画テスト。
//
// 純関数テスト (liff-accordion-depth-style / -tree / -nesting) が通っていても、
// AccordionBlock が depth を className に渡し忘れていれば実機では何も変わらないため、
// ここで DOM まで到達していることを押さえる。
//
// あわせて、この PR で守るべき構造上の不変条件も固定する:
//   - 子 accordion の <button> が親 <button> の子孫にならない（invalid nested interactive）
//   - aria-expanded / aria-controls / role=region / aria-labelledby が各階層で正しく対応する
//   - 親を閉じて開き直しても子/孫の開閉 state が保持される

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
import { AccordionBlock } from "@/components/liff/renderers/AccordionBlock";
import type { AccordionSettings, NestedLiffBlock } from "@/types";

afterEach(cleanup);

const acc = (title: string, children: NestedLiffBlock[] = [], id = `acc-${title}`): NestedLiffBlock => ({
  id,
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

/** A(L1) ├ 説明 └ B(L2) ├ 本文 └ C(L3) └ 最終 */
const TREE: AccordionSettings = {
  title: "MISSION #1",
  children: [
    text("説明テキスト"),
    acc("ヒント1", [text("ヒント本文"), acc("さらにヒント", [text("最終ヒント本文")])]),
  ],
};

const renderTree = () =>
  render(<AccordionBlock title={null} settings={TREE} depth={1} blockId="root" />);

/** 見出しボタンをラベルで引く。 */
const header = (label: string) => screen.getByRole("button", { name: new RegExp(label) });
/** ボタンが制御しているパネル要素。 */
const panelOf = (btn: HTMLElement) =>
  document.getElementById(btn.getAttribute("aria-controls")!)!;

describe("A > B > C の入れ子描画", () => {
  it("A を開くと B が A のパネルの中に現れる（兄弟ではなく子孫）", () => {
    renderTree();
    const a = header("MISSION #1");
    fireEvent.click(a);

    const aPanel = panelOf(a);
    expect(aPanel.hidden).toBe(false);
    // B は A のパネルの内側にある
    const b = within(aPanel).getByRole("button", { name: /ヒント1/ });
    expect(aPanel.contains(b)).toBe(true);
  });

  it("A → B → C と辿って最深部の本文まで表示できる", () => {
    renderTree();
    fireEvent.click(header("MISSION #1"));
    fireEvent.click(header("ヒント1"));
    fireEvent.click(header("さらにヒント"));
    expect(screen.getByText("最終ヒント本文")).toBeTruthy();
  });

  it("C は B のパネルの中、B は A のパネルの中（3 階層の包含関係）", () => {
    renderTree();
    fireEvent.click(header("MISSION #1"));
    fireEvent.click(header("ヒント1"));

    const aPanel = panelOf(header("MISSION #1"));
    const bPanel = panelOf(header("ヒント1"));
    const c = header("さらにヒント");

    expect(bPanel.contains(c)).toBe(true);
    expect(aPanel.contains(bPanel)).toBe(true);
  });
});

describe("階層が見た目で区別できる（RC-1 の修正）", () => {
  it("depth ごとにタイトルの文字サイズが変わる", () => {
    renderTree();
    fireEvent.click(header("MISSION #1"));
    fireEvent.click(header("ヒント1"));

    const size = (label: string) =>
      header(label).querySelector("span")!.className.match(/text-\[(\d+)px\]/)![1];

    expect(size("MISSION #1")).toBe("16");
    expect(size("ヒント1")).toBe("15");
    expect(size("さらにヒント")).toBe("14");
  });

  it("パネルに縦ガイド線と左インデントが付く（＝中身であることが分かる）", () => {
    renderTree();
    const a = header("MISSION #1");
    fireEvent.click(a);
    const cls = panelOf(a).className;
    expect(cls).toContain("border-l");
    expect(cls).toMatch(/\bpl-/);
  });

  it("見出しレベルが depth ごとに 1 段下がる（h3 → h4 → h5）", () => {
    renderTree();
    fireEvent.click(header("MISSION #1"));
    fireEvent.click(header("ヒント1"));

    const tag = (label: string) => header(label).closest("h3,h4,h5")!.tagName;
    expect(tag("MISSION #1")).toBe("H3");
    expect(tag("ヒント1")).toBe("H4");
    expect(tag("さらにヒント")).toBe("H5");
  });
});

describe("DOM 構造上の不変条件", () => {
  it("button の中に button が入らない（invalid nested interactive を作らない）", () => {
    const { container } = renderTree();
    fireEvent.click(header("MISSION #1"));
    fireEvent.click(header("ヒント1"));
    fireEvent.click(header("さらにヒント"));

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const btn of buttons) {
      expect(btn.parentElement?.closest("button")).toBeNull();
    }
  });

  it("各階層で aria-expanded / aria-controls / role=region / aria-labelledby が対応する", () => {
    renderTree();
    fireEvent.click(header("MISSION #1"));
    fireEvent.click(header("ヒント1"));

    for (const label of ["MISSION #1", "ヒント1", "さらにヒント"]) {
      const btn = header(label);
      expect(btn.getAttribute("aria-expanded")).toBeTruthy();
      const panel = panelOf(btn);
      expect(panel).toBeTruthy();
      expect(panel.getAttribute("role")).toBe("region");
      expect(panel.getAttribute("aria-labelledby")).toBe(btn.id);
    }
  });

  it("パネルの id が階層間で衝突しない", () => {
    renderTree();
    fireEvent.click(header("MISSION #1"));
    fireEvent.click(header("ヒント1"));
    const ids = ["MISSION #1", "ヒント1", "さらにヒント"].map(
      (l) => header(l).getAttribute("aria-controls"),
    );
    expect(new Set(ids).size).toBe(3);
  });
});

describe("開閉 state（親を閉じて開き直しても子は維持）", () => {
  it("A を閉じて再度開くと B / C の open 状態が残っている", () => {
    renderTree();
    fireEvent.click(header("MISSION #1"));
    fireEvent.click(header("ヒント1"));
    fireEvent.click(header("さらにヒント"));
    expect(screen.getByText("最終ヒント本文")).toBeTruthy();

    // A を閉じる → 子孫は hidden になる
    fireEvent.click(header("MISSION #1"));
    expect(panelOf(header("MISSION #1")).hidden).toBe(true);

    // A を開き直す → B / C は開いたまま
    fireEvent.click(header("MISSION #1"));
    expect(header("ヒント1").getAttribute("aria-expanded")).toBe("true");
    expect(header("さらにヒント").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("最終ヒント本文")).toBeTruthy();
  });

  it("閉じている間は panel が hidden で、flex クラスが付かない", () => {
    renderTree();
    const a = header("MISSION #1");
    const panel = panelOf(a);
    expect(panel.hidden).toBe(true);
    expect(panel.className).not.toContain("flex");
  });
});

describe("legacy / 異常データでも壊れない", () => {
  it("children なしでも落ちず、未設定メッセージを出す", () => {
    render(<AccordionBlock title={null} settings={{ title: "空" } as AccordionSettings} depth={1} blockId="e" />);
    fireEvent.click(header("空"));
    expect(screen.getByText("（中身は未設定です）")).toBeTruthy();
  });

  it("items のみの legacy accordion は従来どおり項目リストとして描画される", () => {
    const s = { items: [{ title: "Q1", body: "A1" }, { title: "Q2", body: "A2" }] } as AccordionSettings;
    render(<AccordionBlock title={null} settings={s} depth={1} blockId="legacy" />);
    // 親タイトルは出さず、item が並ぶ（既存仕様のまま）
    expect(screen.getByRole("button", { name: /Q1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Q2/ })).toBeTruthy();
    fireEvent.click(header("Q1"));
    expect(screen.getByText("A1")).toBeTruthy();
  });

  it("title 未設定でもフォールバック表示になる", () => {
    render(<AccordionBlock title={null} settings={{} as AccordionSettings} depth={1} blockId="n" />);
    expect(screen.getByRole("button", { name: /タイトル未設定/ })).toBeTruthy();
  });
});
