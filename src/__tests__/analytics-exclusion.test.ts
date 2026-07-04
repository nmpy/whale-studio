// src/__tests__/analytics-exclusion.test.ts
// 分析除外（OA 単位 lineUserId）の集計前フィルタ・マスクの検証。
import { describe, it, expect } from "vitest";
import { maskLineUserId, applyExclusion } from "@/lib/analytics-exclusion";

type P = { lineUserId: string; reachedEnding: boolean };
const progress: P[] = [
  { lineUserId: "Ustaff001", reachedEnding: true  },  // 制作者（除外対象）
  { lineUserId: "Uplayer01", reachedEnding: true  },
  { lineUserId: "Uplayer02", reachedEnding: false },
  { lineUserId: "Utester99", reachedEnding: false },  // テスター（除外対象）
];

describe("maskLineUserId", () => {
  it("末尾4桁のみ表示", () => {
    expect(maskLineUserId("Uabcdef1234")).toBe("U***1234");
  });
  it("短い/空はフルマスク", () => {
    expect(maskLineUserId("U12")).toBe("U***");
    expect(maskLineUserId("")).toBe("U***");
  });
});

describe("applyExclusion — 集計前フィルタ（全指標に一貫適用される元集合）", () => {
  it("除外対象 lineUserId が集計対象から除かれる", () => {
    const excluded = new Set(["Ustaff001", "Utester99"]);
    const kept = applyExclusion(progress, excluded);
    expect(kept.map((p) => p.lineUserId)).toEqual(["Uplayer01", "Uplayer02"]);
  });

  it("除外後の集合で計算すると summary（総数/クリア数）が変わる", () => {
    const excluded = new Set(["Ustaff001"]); // クリア済みの制作者を除外
    const kept = applyExclusion(progress, excluded);
    expect(kept.length).toBe(3);                                   // 総プレイヤー: 4→3
    expect(kept.filter((p) => p.reachedEnding).length).toBe(1);    // クリア: 2→1
  });

  it("除外していない lineUserId は残る", () => {
    const kept = applyExclusion(progress, new Set(["Ustaff001"]));
    expect(kept.some((p) => p.lineUserId === "Uplayer01")).toBe(true);
    expect(kept.some((p) => p.lineUserId === "Uplayer02")).toBe(true);
  });

  it("除外解除（空集合）で全員が再び含まれる", () => {
    expect(applyExclusion(progress, new Set()).length).toBe(progress.length);
  });

  it("非破壊（元配列を変更しない）", () => {
    const before = progress.map((p) => p.lineUserId);
    applyExclusion(progress, new Set(["Ustaff001"]));
    expect(progress.map((p) => p.lineUserId)).toEqual(before);
  });

  it("同一 lineUserId は work をまたいでも一貫して除外される（lineUserId 集合ベース）", () => {
    // 別 work の progress でも lineUserId が同じなら除外される（＝OA 単位除外が同一OA内の作品に効く）
    const multiWork: P[] = [
      { lineUserId: "Ustaff001", reachedEnding: true },  // work A
      { lineUserId: "Ustaff001", reachedEnding: true },  // work B（同じ制作者）
      { lineUserId: "Uplayer01", reachedEnding: true },
    ];
    const kept = applyExclusion(multiWork, new Set(["Ustaff001"]));
    expect(kept.map((p) => p.lineUserId)).toEqual(["Uplayer01"]);
  });
});
