// src/__tests__/onboarding-setup.test.ts
// 作品トップ「セットアップの進捗」の4ステップ化検証。
// 完了条件は 作品作成 / キャラクター作成 / フェーズ作成 / メッセージ追加 の4項目。
// 「フロー設定」「プレビュー確認」は完了条件に含めない。
import { describe, it, expect } from "vitest";
import { SETUP_STEPS, computeSetupProgress } from "@/lib/onboarding-setup";

describe("SETUP_STEPS — 4ステップ・フロー設定/プレビュー確認を含まない", () => {
  it("総ステップ数は 4", () => {
    expect(SETUP_STEPS.length).toBe(4);
  });
  it("フロー設定（scenario）・プレビュー確認（preview）を含まない", () => {
    const keys = SETUP_STEPS.map((s) => s.key as string);
    expect(keys).not.toContain("scenario");
    expect(keys).not.toContain("preview");
    expect(keys).not.toContain("previewed");
    expect(SETUP_STEPS.some((s) => s.label.includes("フロー"))).toBe(false);
    expect(SETUP_STEPS.some((s) => s.label.includes("プレビュー"))).toBe(false);
  });
  it("4番目（最後）は「メッセージ追加」", () => {
    expect(SETUP_STEPS[3].key).toBe("message");
    expect(SETUP_STEPS[3].label).toBe("メッセージ追加");
  });
  it("キー順は work → character → phase → message", () => {
    expect(SETUP_STEPS.map((s) => s.key)).toEqual(["work", "character", "phase", "message"]);
  });
});

describe("computeSetupProgress — 4項目基準", () => {
  it("total は常に 4", () => {
    const p = computeSetupProgress({ hasCharacters: false, hasPhases: false, hasMessages: false });
    expect(p.total).toBe(4);
  });

  it("何もなし: work のみ完了 → 1/4・25%・次は character", () => {
    const p = computeSetupProgress({ hasCharacters: false, hasPhases: false, hasMessages: false });
    expect(p.doneCount).toBe(1);
    expect(p.pct).toBe(25);
    expect(p.nextKey).toBe("character");
    expect(p.allDone).toBe(false);
  });

  it("メッセージだけ未完了: 3/4・75%・次は message（最後の未完了として強調）", () => {
    const p = computeSetupProgress({ hasCharacters: true, hasPhases: true, hasMessages: false });
    expect(p.doneCount).toBe(3);
    expect(p.pct).toBe(75);
    expect(p.nextKey).toBe("message");
    expect(p.allDone).toBe(false);
  });

  it("4項目完了: 4/4・100%・allDone=true（フロー設定の有無に関係なく完了扱い）", () => {
    // hasTransitions=false でも4項目が揃えば完了扱いになる
    const p = computeSetupProgress({ hasCharacters: true, hasPhases: true, hasMessages: true, hasTransitions: false });
    expect(p.doneCount).toBe(4);
    expect(p.pct).toBe(100);
    expect(p.nextKey).toBeNull();
    expect(p.allDone).toBe(true);
  });

  it("hasTransitions は完了判定に影響しない（true でも false でも4項目が同値なら同じ結果）", () => {
    const base = { hasCharacters: true, hasPhases: true, hasMessages: true } as const;
    const withFlow    = computeSetupProgress({ ...base, hasTransitions: true });
    const withoutFlow = computeSetupProgress({ ...base, hasTransitions: false });
    expect(withFlow).toEqual(withoutFlow);
    expect(withFlow.allDone).toBe(true);
  });

  it("completion に scenario/preview キーが存在しない", () => {
    const p = computeSetupProgress({ hasCharacters: true, hasPhases: true, hasMessages: true });
    expect(Object.keys(p.completion).sort()).toEqual(["character", "message", "phase", "work"]);
  });

  it("次ステップ判定は最大で message（scenario には進まない）", () => {
    const p = computeSetupProgress({ hasCharacters: true, hasPhases: true, hasMessages: false });
    expect(p.nextKey).toBe("message");
  });
});
