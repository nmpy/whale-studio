// src/__tests__/onboarding-setup.test.ts
// 作品トップ「セットアップの進捗」の5ステップ化（プレビュー確認を除外）検証。
import { describe, it, expect } from "vitest";
import { SETUP_STEPS, computeSetupProgress } from "@/lib/onboarding-setup";

describe("SETUP_STEPS — 5ステップ・プレビュー確認を含まない", () => {
  it("総ステップ数は 5", () => {
    expect(SETUP_STEPS.length).toBe(5);
  });
  it("プレビュー確認ステップ（preview/previewed）を含まない", () => {
    const keys = SETUP_STEPS.map((s) => s.key as string);
    expect(keys).not.toContain("preview");
    expect(keys).not.toContain("previewed");
    expect(SETUP_STEPS.some((s) => s.label.includes("プレビュー"))).toBe(false);
  });
  it("5番目は「フロー設定」", () => {
    expect(SETUP_STEPS[4].key).toBe("scenario");
    expect(SETUP_STEPS[4].label).toBe("フロー設定");
  });
});

describe("computeSetupProgress — 5項目基準", () => {
  it("total は常に 5", () => {
    const p = computeSetupProgress({ hasCharacters: false, hasPhases: false, hasMessages: false, hasTransitions: false });
    expect(p.total).toBe(5);
  });

  it("何もなし: work のみ完了 → 1/5・20%・次は character", () => {
    const p = computeSetupProgress({ hasCharacters: false, hasPhases: false, hasMessages: false, hasTransitions: false });
    expect(p.doneCount).toBe(1);
    expect(p.pct).toBe(20);
    expect(p.nextKey).toBe("character");
    expect(p.allDone).toBe(false);
  });

  it("フロー設定だけ未完了: 4/5・80%・次は scenario（最後の未完了として強調される）", () => {
    const p = computeSetupProgress({ hasCharacters: true, hasPhases: true, hasMessages: true, hasTransitions: false });
    expect(p.doneCount).toBe(4);
    expect(p.pct).toBe(80);
    expect(p.nextKey).toBe("scenario");
    expect(p.allDone).toBe(false);
  });

  it("全5項目完了: 5/5・100%・allDone=true（セットアップ完了扱い・プレビュー確認は不要）", () => {
    const p = computeSetupProgress({ hasCharacters: true, hasPhases: true, hasMessages: true, hasTransitions: true });
    expect(p.doneCount).toBe(5);
    expect(p.pct).toBe(100);
    expect(p.nextKey).toBeNull();
    expect(p.allDone).toBe(true);
  });

  it("completion に preview/previewed キーが存在しない（完了条件に含まれない）", () => {
    const p = computeSetupProgress({ hasCharacters: true, hasPhases: true, hasMessages: true, hasTransitions: true });
    expect(Object.keys(p.completion).sort()).toEqual(["character", "message", "phase", "scenario", "work"]);
  });

  it("中間: character/phase まで → 3/5・60%・次は message", () => {
    const p = computeSetupProgress({ hasCharacters: true, hasPhases: true, hasMessages: false, hasTransitions: false });
    expect(p.doneCount).toBe(3);
    expect(p.pct).toBe(60);
    expect(p.nextKey).toBe("message");
  });
});
