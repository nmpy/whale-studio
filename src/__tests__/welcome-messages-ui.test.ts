// src/__tests__/welcome-messages-ui.test.ts
//
// あいさつ編集UIロジック（純関数）の検証。
import { describe, it, expect } from "vitest";
import {
  initWelcomeItems,
  validateWelcomeItems,
  moveWelcomeItem,
  buildWelcomeMessagesPayload,
  getStartTriggerFromPhases,
  getStartPhaseId,
  normalizeStartTrigger,
  clampWelcomeLoadingSeconds,
  WELCOME_TEXT_MAX,
} from "@/lib/welcome-messages-ui";
import type { WelcomeMessageItem } from "@/lib/welcome-messages";

describe("initWelcomeItems", () => {
  it("welcome_messages 非空ならそれを使う", () => {
    const items: WelcomeMessageItem[] = [{ type: "text", text: "A" }];
    expect(initWelcomeItems({ welcome_messages: items, welcome_message: "旧" })).toBe(items);
  });
  it("welcome_messages 空 + welcome_message あり → 1件 text（互換）", () => {
    expect(initWelcomeItems({ welcome_messages: [], welcome_message: "  ようこそ  " }))
      .toEqual([{ type: "text", text: "ようこそ" }]);
  });
  it("両方空 → []", () => {
    expect(initWelcomeItems({ welcome_messages: [], welcome_message: "" })).toEqual([]);
    expect(initWelcomeItems({})).toEqual([]);
  });
  it("全削除後（welcome_messages=[] / welcome_message=null）→ [] が維持される", () => {
    expect(initWelcomeItems({ welcome_messages: [], welcome_message: null })).toEqual([]);
  });
});

describe("validateWelcomeItems", () => {
  it("5件OK", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ type: "text" as const, text: `t${i}` }));
    expect(validateWelcomeItems(five).ok).toBe(true);
  });
  it("6件NG（overall）", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ type: "text" as const, text: `t${i}` }));
    const r = validateWelcomeItems(six);
    expect(r.ok).toBe(false);
    expect(r.overall).toContain("最大");
  });
  it("空 text NG（item エラー）", () => {
    const r = validateWelcomeItems([{ type: "text", text: "   " }]);
    expect(r.ok).toBe(false);
    expect(r.itemErrors[0]).toBe("テキストを入力してください");
  });
  it("2000文字超 NG", () => {
    const r = validateWelcomeItems([{ type: "text", text: "a".repeat(WELCOME_TEXT_MAX + 1) }]);
    expect(r.ok).toBe(false);
    expect(r.itemErrors[0]).toContain("2000");
  });
  it("imageUrl なし NG", () => {
    const r = validateWelcomeItems([{ type: "image", imageUrl: "" }]);
    expect(r.ok).toBe(false);
    expect(r.itemErrors[0]).toContain("https");
  });
  it("http 画像URL NG", () => {
    const r = validateWelcomeItems([{ type: "image", imageUrl: "http://ex.com/a.png" }]);
    expect(r.ok).toBe(false);
  });
  it("previewImageUrl が http なら NG", () => {
    const r = validateWelcomeItems([{ type: "image", imageUrl: "https://ex.com/a.png", previewImageUrl: "http://ex.com/p.png" }]);
    expect(r.ok).toBe(false);
    expect(r.itemErrors[0]).toContain("プレビュー");
  });
  it("text + image 混在の正常系 OK", () => {
    const r = validateWelcomeItems([
      { type: "text", text: "やあ" },
      { type: "image", imageUrl: "https://ex.com/a.png" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.itemErrors).toEqual([null, null]);
  });
});

describe("moveWelcomeItem", () => {
  const items: WelcomeMessageItem[] = [
    { type: "text", text: "A" }, { type: "text", text: "B" }, { type: "text", text: "C" },
  ];
  it("up: index 1 → A と B が入れ替わる", () => {
    expect(moveWelcomeItem(items, 1, "up").map((x) => (x as { text: string }).text)).toEqual(["B", "A", "C"]);
  });
  it("down: index 1 → B と C が入れ替わる", () => {
    expect(moveWelcomeItem(items, 1, "down").map((x) => (x as { text: string }).text)).toEqual(["A", "C", "B"]);
  });
  it("先頭の up は no-op", () => {
    expect(moveWelcomeItem(items, 0, "up").map((x) => (x as { text: string }).text)).toEqual(["A", "B", "C"]);
  });
  it("末尾の down は no-op", () => {
    expect(moveWelcomeItem(items, 2, "down").map((x) => (x as { text: string }).text)).toEqual(["A", "B", "C"]);
  });
  it("元配列は破壊しない", () => {
    moveWelcomeItem(items, 1, "up");
    expect(items.map((x) => (x as { text: string }).text)).toEqual(["A", "B", "C"]);
  });
});

describe("buildWelcomeMessagesPayload", () => {
  it("{ welcome_messages: items }、text は trim", () => {
    expect(buildWelcomeMessagesPayload([{ type: "text", text: "  やあ  " }]))
      .toEqual({ welcome_messages: [{ type: "text", text: "やあ" }] });
  });
  it("image は imageUrl のみ（preview/alt 未設定なら含めない）", () => {
    expect(buildWelcomeMessagesPayload([{ type: "image", imageUrl: "https://ex.com/a.png" }]))
      .toEqual({ welcome_messages: [{ type: "image", imageUrl: "https://ex.com/a.png" }] });
  });
  it("空配列 → { welcome_messages: [] }", () => {
    expect(buildWelcomeMessagesPayload([])).toEqual({ welcome_messages: [] });
  });

  // PR-B2: 第2引数（loadingSeconds）で welcome_loading_seconds を含める。
  it("第2引数 0/3/8 → welcome_loading_seconds を含める", () => {
    const items: WelcomeMessageItem[] = [{ type: "text", text: "a" }];
    expect(buildWelcomeMessagesPayload(items, 0))
      .toEqual({ welcome_messages: [{ type: "text", text: "a" }], welcome_loading_seconds: 0 });
    expect(buildWelcomeMessagesPayload(items, 3).welcome_loading_seconds).toBe(3);
    expect(buildWelcomeMessagesPayload(items, 8).welcome_loading_seconds).toBe(8);
  });
  it("第2引数で 9/負/小数は clamp（9→8 / -1→0 / 2.7→2）", () => {
    const items: WelcomeMessageItem[] = [{ type: "text", text: "a" }];
    expect(buildWelcomeMessagesPayload(items, 9).welcome_loading_seconds).toBe(8);
    expect(buildWelcomeMessagesPayload(items, -1).welcome_loading_seconds).toBe(0);
    expect(buildWelcomeMessagesPayload(items, 2.7).welcome_loading_seconds).toBe(2);
  });
  it("第2引数 未指定 → welcome_loading_seconds を含まない（従来互換）", () => {
    const r = buildWelcomeMessagesPayload([{ type: "text", text: "a" }]);
    expect("welcome_loading_seconds" in r).toBe(false);
  });
});

describe("clampWelcomeLoadingSeconds", () => {
  it("0/8 はそのまま", () => {
    expect(clampWelcomeLoadingSeconds(0)).toBe(0);
    expect(clampWelcomeLoadingSeconds(8)).toBe(8);
  });
  it("9以上→8 / 負→0 / 小数→floor / 非数→0", () => {
    expect(clampWelcomeLoadingSeconds(9)).toBe(8);
    expect(clampWelcomeLoadingSeconds(100)).toBe(8);
    expect(clampWelcomeLoadingSeconds(-3)).toBe(0);
    expect(clampWelcomeLoadingSeconds(2.9)).toBe(2);
    expect(clampWelcomeLoadingSeconds(NaN)).toBe(0);
    expect(clampWelcomeLoadingSeconds("3" as unknown)).toBe(0);
  });
});

describe("getStartTriggerFromPhases", () => {
  it("start フェーズあり → start_trigger 値", () => {
    expect(getStartTriggerFromPhases([
      { phase_type: "normal", start_trigger: null },
      { phase_type: "start", start_trigger: "ぼうけん" },
    ])).toBe("ぼうけん");
  });
  it("start フェーズなし → null", () => {
    expect(getStartTriggerFromPhases([{ phase_type: "normal", start_trigger: "x" }])).toBeNull();
  });
  it("start_trigger が空白 → null", () => {
    expect(getStartTriggerFromPhases([{ phase_type: "start", start_trigger: "   " }])).toBeNull();
  });
});

describe("getStartPhaseId", () => {
  it("start フェーズあり → その id", () => {
    expect(getStartPhaseId([
      { id: "p-normal", phase_type: "normal" },
      { id: "p-start", phase_type: "start" },
      { id: "p-global", phase_type: "global" },
    ])).toBe("p-start");
  });
  it("start フェーズなし → null", () => {
    expect(getStartPhaseId([{ id: "p1", phase_type: "normal" }])).toBeNull();
    expect(getStartPhaseId([])).toBeNull();
  });
});

describe("normalizeStartTrigger", () => {
  it("trim される", () => {
    expect(normalizeStartTrigger("  はじめる  ")).toBe("はじめる");
  });
  it("空文字/空白 → null（未設定）", () => {
    expect(normalizeStartTrigger("")).toBeNull();
    expect(normalizeStartTrigger("   ")).toBeNull();
  });
  it("改行はスペースに正規化（改行不可）", () => {
    expect(normalizeStartTrigger("はじ\nめる")).toBe("はじ める");
    expect(normalizeStartTrigger("a\r\nb")).toBe("a b");
  });
});
