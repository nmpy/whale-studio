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

import { maskTail, buildPlayerCandidates } from "@/lib/analytics-exclusion";

describe("maskTail — UID を末尾のみ表示（フル露出しない）", () => {
  it("末尾6桁（既定）", () => {
    expect(maskTail("Uabcdef123456")).toBe("...123456");
  });
  it("短い/空も安全", () => {
    expect(maskTail("U12")).toBe("...U12");
    expect(maskTail("")).toBe("...");
  });
});

describe("buildPlayerCandidates — 除外候補プレイヤーの組み立て", () => {
  const D = (s: string) => new Date(s);
  it("表示名あり→「{名前}（...末尾）」/ 無し→「名前未取得（...末尾）」", () => {
    const r = buildPlayerCandidates(
      [{ lineUserId: "Uplayer0001", lastActiveAt: D("2026-07-01T00:00:00Z") }],
      new Map([["Uplayer0001", "山田花子"]]),
      new Set(),
    );
    expect(r[0].label).toBe("山田花子（...er0001）");
    const r2 = buildPlayerCandidates([{ lineUserId: "Uplayer0002", lastActiveAt: null }], new Map(), new Set());
    expect(r2[0].label).toBe("名前未取得（...er0002）");
  });

  it("空 lineUserId は候補に出さない（fake なし）", () => {
    const r = buildPlayerCandidates(
      [{ lineUserId: "", lastActiveAt: null }, { lineUserId: "  ", lastActiveAt: null }, { lineUserId: "Uok000001", lastActiveAt: null }],
      new Map(), new Set(),
    );
    expect(r).toHaveLength(1);
    expect(r[0].lineUserId).toBe("Uok000001");
  });

  it("重複 lineUserId は1件に集約", () => {
    const r = buildPlayerCandidates(
      [{ lineUserId: "Udup00001", lastActiveAt: D("2026-07-01T00:00:00Z") }, { lineUserId: "Udup00001", lastActiveAt: D("2026-07-02T00:00:00Z") }],
      new Map(), new Set(),
    );
    expect(r).toHaveLength(1);
  });

  it("既に除外済みは isAlreadyExcluded=true", () => {
    const r = buildPlayerCandidates(
      [{ lineUserId: "Uexcluded1", lastActiveAt: null }, { lineUserId: "Uactive001", lastActiveAt: null }],
      new Map(), new Set(["Uexcluded1"]),
    );
    expect(r.find((c) => c.lineUserId === "Uexcluded1")!.isAlreadyExcluded).toBe(true);
    expect(r.find((c) => c.lineUserId === "Uactive001")!.isAlreadyExcluded).toBe(false);
  });

  it("ソート: 表示名あり → 最終アクティブ新しい順 → lineUserId", () => {
    const r = buildPlayerCandidates(
      [
        { lineUserId: "Ucccccccc", lastActiveAt: D("2026-07-01T00:00:00Z") }, // 名前なし・古い
        { lineUserId: "Ubbbbbbbb", lastActiveAt: D("2026-07-05T00:00:00Z") }, // 名前なし・新しい
        { lineUserId: "Uaaaaaaaa", lastActiveAt: D("2026-06-01T00:00:00Z") }, // 名前あり・最も古いが名前優先
      ],
      new Map([["Uaaaaaaaa", "名前あり"]]),
      new Set(),
    );
    expect(r.map((c) => c.lineUserId)).toEqual(["Uaaaaaaaa", "Ubbbbbbbb", "Ucccccccc"]);
  });

  it("元配列を破壊しない・maskedLineUserId はフル UID を含まない", () => {
    const rows = [{ lineUserId: "Ufull1234567890abcdef", lastActiveAt: null }];
    const snap = rows.map((x) => x.lineUserId);
    const r = buildPlayerCandidates(rows, new Map(), new Set());
    expect(rows.map((x) => x.lineUserId)).toEqual(snap);
    expect(r[0].maskedLineUserId).toBe("...abcdef");
    expect(r[0].maskedLineUserId).not.toContain("Ufull");
  });
});
