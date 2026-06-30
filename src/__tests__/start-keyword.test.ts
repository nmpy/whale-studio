import { describe, it, expect } from "vitest";
import {
  normalizeStartKeyword,
  startKeywordsOf,
  matchStartWork,
  findStartKeywordConflicts,
  conflictsWithOthers,
} from "@/lib/start-keyword";

describe("normalizeStartKeyword", () => {
  it("前後スペースを除去する", () => {
    expect(normalizeStartKeyword("  森の手紙  ")).toBe("森の手紙");
  });
  it("連続スペースを1つにする", () => {
    expect(normalizeStartKeyword("森の   手紙")).toBe("森の 手紙");
  });
  it("英数字は小文字化する", () => {
    expect(normalizeStartKeyword("Start123")).toBe("start123");
  });
  it("全角英数は NFKC で半角に統一する", () => {
    expect(normalizeStartKeyword("ＳＴＡＲＴ")).toBe("start");
  });
  it("空・null・undefined は空文字", () => {
    expect(normalizeStartKeyword("")).toBe("");
    expect(normalizeStartKeyword("   ")).toBe("");
    expect(normalizeStartKeyword(null)).toBe("");
    expect(normalizeStartKeyword(undefined)).toBe("");
  });
});

describe("startKeywordsOf", () => {
  it("startKeyword と startTrigger の両方を候補にする", () => {
    expect(startKeywordsOf({ id: "a", startKeyword: "森の手紙", startTrigger: "はじめる" }))
      .toEqual(["森の手紙", "はじめる"]);
  });
  it("空は除外・重複は除外", () => {
    expect(startKeywordsOf({ id: "a", startKeyword: "はじめる", startTrigger: " はじめる " }))
      .toEqual(["はじめる"]);
    expect(startKeywordsOf({ id: "a", startKeyword: null, startTrigger: "" })).toEqual([]);
  });
});

describe("matchStartWork", () => {
  const works = [
    { id: "A", startKeyword: "エリーゼ開始", startTrigger: null },
    { id: "B", startKeyword: "森の手紙", startTrigger: null },
    { id: "C", startKeyword: "迷子のくじら", startTrigger: "はじめる" },
  ];

  it("startKeyword 一致で正しい作品を返す", () => {
    expect(matchStartWork("森の手紙", works)?.id).toBe("B");
    expect(matchStartWork("エリーゼ開始", works)?.id).toBe("A");
  });
  it("startTrigger 一致でもその作品を返す", () => {
    expect(matchStartWork("はじめる", works)?.id).toBe("C");
  });
  it("前後スペース付きでも一致する", () => {
    expect(matchStartWork("  森の手紙 ", works)?.id).toBe("B");
  });
  it("非一致は null", () => {
    expect(matchStartWork("こんにちは", works)).toBeNull();
    expect(matchStartWork("", works)).toBeNull();
  });
  it("複数作品に一致する曖昧なキーワードは null（安全側で開始しない）", () => {
    const dup = [
      { id: "A", startKeyword: "はじめる", startTrigger: null },
      { id: "B", startKeyword: null, startTrigger: "はじめる" },
    ];
    expect(matchStartWork("はじめる", dup)).toBeNull();
  });
});

describe("findStartKeywordConflicts / conflictsWithOthers", () => {
  it("startKeyword 同士の重複を検出", () => {
    const ws = [
      { id: "A", startKeyword: "スタート", startTrigger: null },
      { id: "B", startKeyword: "スタート", startTrigger: null },
    ];
    expect(findStartKeywordConflicts(ws)).toContain("スタート");
  });
  it("startKeyword と他作品 startTrigger の重複も検出", () => {
    const ws = [
      { id: "A", startKeyword: "はじめる", startTrigger: null },
      { id: "B", startKeyword: null, startTrigger: "はじめる" },
    ];
    expect(findStartKeywordConflicts(ws)).toContain("はじめる");
  });
  it("重複なしは空配列", () => {
    const ws = [
      { id: "A", startKeyword: "森の手紙", startTrigger: null },
      { id: "B", startKeyword: "迷子のくじら", startTrigger: null },
    ];
    expect(findStartKeywordConflicts(ws)).toEqual([]);
  });

  it("conflictsWithOthers: 他作品の候補と衝突したら true", () => {
    const others = [{ id: "B", startKeyword: "森の手紙", startTrigger: "はじめる" }];
    expect(conflictsWithOthers("森の手紙", others)).toBe(true);
    expect(conflictsWithOthers("はじめる", others)).toBe(true); // 他作品の startTrigger とも衝突
    expect(conflictsWithOthers("別キーワード", others)).toBe(false);
  });
  it("conflictsWithOthers: 空キーワードは衝突しない（未設定は許容）", () => {
    const others = [{ id: "B", startKeyword: "森の手紙", startTrigger: null }];
    expect(conflictsWithOthers("", others)).toBe(false);
    expect(conflictsWithOthers(null, others)).toBe(false);
  });
});
