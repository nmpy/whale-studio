// src/__tests__/liff-page-margin-y.test.ts
//
// ページ上下の余白 (settings_json.page_margin_y)。
//
// page_type ごとに現行の上下余白が違う（default 12/32px・hint 24/96px・
// faq/survey/contact 20/96px・hint_search 16/40px）ため、絶対値で揃えるのではなく
// **現行値に倍率を掛ける**方式にしている（narrow ×0.5 / wide ×1.75）。
//
// 最重要の不変条件:
//   1. 未設定なら calc(<現行px> * 1) = 現行値そのもの（既存ページは 1px も動かない）
//   2. 当て先は .liff-page-body だけ。.liff-player-main を直接狙うと戻る導線・
//      ページタイトルにも当たり、上下余白が多重に変わる

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolvePageMarginY,
  pageMarginYClass,
  liffRootClass,
} from "@/components/liff/liff-style-helpers";
import { liffPageConfigSettingsSchema } from "@/lib/validations";
import type { LiffPageConfigSettings } from "@/types";

const S = (o: Record<string, unknown>): LiffPageConfigSettings => o as LiffPageConfigSettings;
const CSS = readFileSync(join(process.cwd(), "src/app/liff/liff-font.css"), "utf8");
const read = (f: string) => readFileSync(join(process.cwd(), "src/components/liff", f), "utf8");

// Tailwind のスペーシング（4px 刻み）
const PX: Record<string, number> = { "3": 12, "4": 16, "5": 20, "6": 24, "8": 32, "10": 40, "24": 96 };

const RENDERERS = [
  "LiffRenderer.tsx", "HintSiteRenderer.tsx", "FaqRenderer.tsx",
  "SurveyRenderer.tsx", "ContactRenderer.tsx", "HintSearchRenderer.tsx",
];

describe("後方互換 — 未設定ページは従来のまま", () => {
  it("未設定 / normal / 不正値では root class が増えない", () => {
    expect(liffRootClass(undefined)).toBe("");
    expect(liffRootClass({})).toBe("");
    expect(liffRootClass(S({ page_margin_y: "normal" }))).toBe("");
    expect(liffRootClass(S({ page_margin_y: "tight" }))).toBe("");
  });

  it("倍率が未設定なら calc(<px> * 1) = 現行値そのもの", () => {
    // fallback が 1 でないと、class の付かないページまで動いてしまう
    const rules = CSS.split("\n").filter((l) => l.includes(".liff-page-body.p"));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).toContain("var(--liff-page-y-mul, 1)");
  });
});

describe("解決と class", () => {
  it("未設定・不正値は normal", () => {
    expect(resolvePageMarginY(undefined)).toBe("normal");
    expect(resolvePageMarginY(S({ page_margin_y: 0 }))).toBe("normal");
  });

  it("narrow / wide だけ class が付く", () => {
    expect(pageMarginYClass("normal")).toBe("");
    expect(pageMarginYClass("narrow")).toBe("liff-margin-y--narrow");
    expect(pageMarginYClass("wide")).toBe("liff-margin-y--wide");
  });

  it("倍率は narrow 0.5 / wide 1.75", () => {
    expect(CSS).toContain(".liff-margin-y--narrow { --liff-page-y-mul: 0.5; }");
    expect(CSS).toContain(".liff-margin-y--wide { --liff-page-y-mul: 1.75; }");
  });
});

// 当て先を .liff-player-main にすると、戻る導線 (pt-3) や
// ページタイトル (pt-3 pb-2) にも当たり上下余白が多重に変わる。
describe("当て先は本文コンテナだけに限定されている", () => {
  it("CSS は .liff-page-body にスコープしている", () => {
    for (const l of CSS.split("\n").filter((x) => x.includes("--liff-page-y-mul") && x.includes("padding"))) {
      expect(l, l).toContain(".liff-page-body");
    }
  });

  it("LiffSinglePageRenderer の戻る導線・タイトルにはマーカーが付いていない", () => {
    const src = read("LiffSinglePageRenderer.tsx");
    for (const l of src.split("\n").filter((x) => x.includes("liff-player-main"))) {
      expect(l, `多重適用になる: ${l.trim()}`).not.toContain("liff-page-body");
    }
  });

  it("各 renderer の本文コンテナはちょうど 1 つだけマーカーを持つ", () => {
    for (const f of RENDERERS) {
      const n = (read(f).match(/liff-page-body/g) ?? []).length;
      expect(n, `${f} のマーカー数`).toBe(1);
    }
  });
});

// renderer の pt-/pb- を変えたのに CSS の px を直し忘れると、
// 倍率 1 のときの計算値がズレて既存ページが動く。
describe("renderer の現行値と CSS の px が一致している（ドリフト防止）", () => {
  it("マーカー要素が使う pt-/pb- はすべて CSS 側に同値で定義されている", () => {
    for (const f of RENDERERS) {
      const cls = read(f).match(/"liff-player-main liff-page-body[^"]*"/)![0];
      const pt = cls.match(/\bpt-(\d+)\b/)![1];
      const pb = cls.match(/\bpb-(\d+)\b/)![1];
      // CSS 側は桁揃えで空白が揺れるので、空白量には依存しない形で突き合わせる
      const rule = (side: string, n: string, px: number) =>
        new RegExp(`\\.liff-page-body\\.p${side}-${n}\\s*\\{\\s*padding-${side === "t" ? "top" : "bottom"}:\\s*calc\\(${px}px \\* var\\(--liff-page-y-mul, 1\\)\\);`);
      expect(CSS, `${f} の pt-${pt} が CSS に無い/px 不一致`).toMatch(rule("t", pt, PX[pt]));
      expect(CSS, `${f} の pb-${pb} が CSS に無い/px 不一致`).toMatch(rule("b", pb, PX[pb]));
    }
  });
});

describe("他の余白設定と独立している", () => {
  it("page_margin_x / block_gap と併用できる", () => {
    const cls = liffRootClass(S({ page_margin_x: "narrow", block_gap: "wide", page_margin_y: "wide" }));
    expect(cls).toContain("liff-margin-x--narrow");
    expect(cls).toContain("liff-gap--wide");
    expect(cls).toContain("liff-margin-y--wide");
  });
});

describe("保存バリデーション", () => {
  it("3 段階だけ通る", () => {
    for (const v of ["narrow", "normal", "wide"]) {
      expect(liffPageConfigSettingsSchema.safeParse({ page_margin_y: v }).success).toBe(true);
    }
    expect(liffPageConfigSettingsSchema.safeParse({ page_margin_y: "tight" }).success).toBe(false);
    expect(liffPageConfigSettingsSchema.safeParse({}).success).toBe(true);
  });
});
