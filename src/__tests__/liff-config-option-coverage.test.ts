// src/__tests__/liff-config-option-coverage.test.ts
//
// CMS の select が、その設定の取りうる値を漏れなく出しているかを固定する。
//
// 追加の経緯: 設定を足すときは 型 / helper / CSS / zod / CMS の 5 層を触る必要があり、
// CMS だけ取りこぼすと「機能はあるのに選べない」、逆に CMS だけ先行すると
// 「選べるのに効かない」状態になる。どちらも renderer 側のテストでは検出できない。
//
// 文言そのものは意図的に検査しない（運用に合わせて変わるため）。値の網羅だけを見る。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CMS = readFileSync(join(process.cwd(), "src/components/liff/LiffConfigHeader.tsx"), "utf8");

/** updateSetting("key", ...) を含む select ブロックから option の value を集める。 */
function optionValuesFor(settingKey: string): string[] {
  const needle = `updateSetting("${settingKey}"`;
  const at = CMS.indexOf(needle);
  expect(at, `${settingKey} を更新する UI が CMS に無い`).toBeGreaterThan(-1);
  const close = CMS.indexOf("</select>", at);
  expect(close, `${settingKey} の select が閉じていない`).toBeGreaterThan(-1);
  return [...CMS.slice(at, close).matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
}

const SCALE = ["xs", "sm", "md", "lg", "xl", "xxl"];
const SPACING = ["narrow", "normal", "wide"];

describe("文字サイズ系は 6 段階すべて選べる", () => {
  it.each([
    ["font_scale", SCALE],
    ["heading_scale", SCALE],
  ])("%s", (key, expected) => {
    expect(optionValuesFor(key).sort()).toEqual([...expected].sort());
  });

  // title_scale / accordion_title_scale は「見出しに合わせる」= 未設定 を先頭に持つ
  it.each([["title_scale"], ["accordion_title_scale"]])("%s は未設定 + 6 段階", (key) => {
    const vals = optionValuesFor(key);
    expect(vals[0], "先頭は未設定（見出しに合わせる）であること").toBe("");
    expect(vals.slice(1).sort()).toEqual([...SCALE].sort());
  });
});

describe("余白系は 3 段階すべて選べる", () => {
  it.each([["page_margin_x"], ["block_gap"], ["page_margin_y"]])("%s", (key) => {
    expect(optionValuesFor(key).sort()).toEqual([...SPACING].sort());
  });

  it("accordion_header_spacing は未設定 + 3 段階", () => {
    const vals = optionValuesFor("accordion_header_spacing");
    expect(vals[0]).toBe("");
    expect(vals.slice(1).sort()).toEqual([...SPACING].sort());
  });
});

describe("その他の設定も値を網羅している", () => {
  it("カラーモードは 7 種", () => {
    expect(optionValuesFor("color_mode").sort())
      .toEqual(["bordeaux", "dark", "dot", "light", "sepia", "system", "terminal"]);
  });

  it("横線は show / hide", () => {
    for (const k of ["block_divider", "accordion_divider"]) {
      expect(optionValuesFor(k).sort()).toEqual(["hide", "show"]);
    }
  });

  it("文字色は 4 種", () => {
    for (const k of ["heading_color", "body_color"]) {
      expect(optionValuesFor(k).sort()).toEqual(["default", "green", "red", "white"]);
    }
  });

  it("キャラクターのサイズ / 配置 / 画質", () => {
    expect(optionValuesFor("character_size").sort()).toEqual(["lg", "md", "sm"]);
    expect(optionValuesFor("character_position").sort()).toEqual(["top_left", "top_right"]);
    expect(optionValuesFor("character_rendering").sort()).toEqual(["pixelated", "smooth"]);
  });
});
