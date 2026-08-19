/**
 * src/__tests__/liff-accordion-nesting.test.ts
 *
 * 「A > B > C の親子関係が、CMS の state 形状のまま保存 payload → 検証を通り抜けて
 *  一切失われない」ことを固定する統合テスト。
 *
 * この PR の主眼は表現の修正であってデータ構造の変更ではないため、
 * ここが緑である限り既存データ・既存保存経路は壊れていない。
 */
import { describe, it, expect } from "vitest";
import {
  bulkSaveLiffPageSchema,
  validateBlockSettings,
  LIFF_MAX_ACCORDION_DEPTH,
} from "@/lib/validations";
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
const image = (url: string): NestedLiffBlock => ({
  id: `i-${url}`,
  block_type: "image",
  title: null,
  settings_json: { image_url: url },
});

/** ページ 1 枚ぶんの保存 payload を組む（useLiffConfig.saveAll と同じ形）。 */
const pageWith = (settings: AccordionSettings) => ({
  blocks: [{ block_type: "accordion" as const, title: "MISSION #1", settings_json: settings }],
});

describe("depth 上限は 3 のまま（この PR では変更しない）", () => {
  it("LIFF_MAX_ACCORDION_DEPTH === 3", () => {
    expect(LIFF_MAX_ACCORDION_DEPTH).toBe(3);
  });
});

describe("A > B > C の 3 階層", () => {
  // A(L1) ├ text
  //       └ B(L2) ├ text
  //               └ C(L3) └ text
  const tree: AccordionSettings = {
    title: "MISSION #1",
    children: [
      text("説明テキスト"),
      acc("ヒント1", [text("ヒント本文"), acc("さらにヒント", [text("最終ヒント本文")])]),
    ],
  };

  it("保存 payload を通しても構造が 1 バイトも変わらない", () => {
    const parsed = bulkSaveLiffPageSchema.parse(pageWith(tree));
    expect(parsed.blocks[0].settings_json).toEqual(tree);
  });

  it("検証を通る", () => {
    expect(validateBlockSettings("accordion", tree).success).toBe(true);
  });

  it("保存後に L1 → L2 → L3 → 本文 まで辿れる（親子関係が失われていない）", () => {
    const parsed = bulkSaveLiffPageSchema.parse(pageWith(tree));
    const l1 = parsed.blocks[0].settings_json as AccordionSettings;
    expect(l1.title).toBe("MISSION #1");

    const l2 = l1.children![1];
    expect(l2.block_type).toBe("accordion");
    const l2s = l2.settings_json as AccordionSettings;
    expect(l2s.title).toBe("ヒント1");

    const l3 = l2s.children![1];
    expect(l3.block_type).toBe("accordion");
    const l3s = l3.settings_json as AccordionSettings;
    expect(l3s.title).toBe("さらにヒント");

    const leaf = l3s.children![0];
    expect(leaf.block_type).toBe("free_text");
    expect((leaf.settings_json as { body: string }).body).toBe("最終ヒント本文");
  });
});

describe("sibling / mixed contents", () => {
  it("同一階層に accordion を並べられる（A ├ B └ C）", () => {
    const s: AccordionSettings = { title: "A", children: [acc("B"), acc("C")] };
    expect(validateBlockSettings("accordion", s).success).toBe(true);
    const parsed = bulkSaveLiffPageSchema.parse(pageWith(s));
    expect((parsed.blocks[0].settings_json as AccordionSettings).children).toHaveLength(2);
  });

  it("accordion と通常ブロックを混在できる（A ├ Text ├ Image └ B）", () => {
    const s: AccordionSettings = {
      title: "A",
      children: [text("説明"), image("https://example.com/a.png"), acc("B", [text("b")])],
    };
    expect(validateBlockSettings("accordion", s).success).toBe(true);
    const parsed = bulkSaveLiffPageSchema.parse(pageWith(s));
    expect(parsed.blocks[0].settings_json).toEqual(s);
  });
});

describe("深度制限", () => {
  it("L3 の中に text は入れられる", () => {
    const s: AccordionSettings = {
      title: "A",
      children: [acc("B", [acc("C", [text("ここは OK")])])],
    };
    expect(validateBlockSettings("accordion", s).success).toBe(true);
  });

  it("L3 の中に accordion D は入れられない（保存前に弾かれる）", () => {
    const s: AccordionSettings = {
      title: "A",
      children: [acc("B", [acc("C", [acc("D")])])],
    };
    const r = validateBlockSettings("accordion", s);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toContain(`最大 ${LIFF_MAX_ACCORDION_DEPTH} 階層`);
    }
  });
});

describe("legacy / 不正データ", () => {
  it("children を持たない既存 accordion がそのまま通る", () => {
    for (const s of [{}, { title: "A" }, { title: "A", children: [] }, { title: "A", default_open: true }]) {
      expect(validateBlockSettings("accordion", s).success).toBe(true);
    }
  });

  it("items のみの legacy accordion がそのまま通る（表示は従来どおり）", () => {
    const s: AccordionSettings = { items: [{ title: "Q1", body: "A1" }, { title: "Q2", body: "A2" }] };
    expect(validateBlockSettings("accordion", s).success).toBe(true);
    const parsed = bulkSaveLiffPageSchema.parse(pageWith(s));
    expect(parsed.blocks[0].settings_json).toEqual(s);
  });

  it("children が undefined / 空でも保存 payload が壊れない", () => {
    const s = { title: "A", children: undefined } as AccordionSettings;
    expect(() => bulkSaveLiffPageSchema.parse(pageWith(s))).not.toThrow();
  });

  it("入れ子の accordion に id が無い legacy 形状でも通る", () => {
    const s = {
      title: "A",
      children: [{ block_type: "accordion", settings_json: { title: "B", children: [] } }],
    } as unknown as AccordionSettings;
    expect(validateBlockSettings("accordion", s).success).toBe(true);
  });
});
