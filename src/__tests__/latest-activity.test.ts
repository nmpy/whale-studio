// src/__tests__/latest-activity.test.ts
// アカウント/作品配下の「最新活動日時」集計の純関数 latestOf の検証。
import { describe, it, expect } from "vitest";
import { latestOf } from "@/lib/latest-activity";

const D = (s: string) => new Date(s);
const OA_UPD = "2026-06-20T00:00:00.000Z";
const OA_CRT = "2026-01-01T00:00:00.000Z";
const WORK   = "2026-07-01T00:00:00.000Z";
const MSG    = "2026-07-04T09:00:00.000Z"; // 今日編集したメッセージ
const PHASE  = "2026-07-03T00:00:00.000Z";

describe("latestOf — 最新活動日時の合成", () => {
  it("Oa.updatedAt より Work.updatedAt が新しければ Work が採用される", () => {
    expect(latestOf(D(OA_UPD), D(WORK))?.toISOString()).toBe(WORK);
  });

  it("Work.updatedAt より Message.updatedAt が新しければ Message が採用される", () => {
    expect(latestOf(D(WORK), D(MSG))?.toISOString()).toBe(MSG);
  });

  it("Oa/Work/Phase/Message 混在でも最大（今日の Message）を返す", () => {
    expect(latestOf(D(OA_UPD), D(OA_CRT), D(WORK), D(PHASE), D(MSG))?.toISOString()).toBe(MSG);
  });

  it("子要素が無ければ Oa.updatedAt（＝渡された中の最大）を返す", () => {
    // 子は全て null。Oa.updatedAt / createdAt のみ。
    expect(latestOf(null, undefined, D(OA_UPD), D(OA_CRT))?.toISOString()).toBe(OA_UPD);
  });

  it("updatedAt 系が全て null なら createdAt にフォールバックできる（createdAt を最後に渡す）", () => {
    expect(latestOf(null, null, D(OA_CRT))?.toISOString()).toBe(OA_CRT);
  });

  it("全て null/無効 → null（呼び出し側で createdAt フォールバック）", () => {
    expect(latestOf(null, undefined, "not-a-date")).toBeNull();
  });

  it("ISO 文字列と Date が混在しても比較できる（文字列比較でなく時刻比較）", () => {
    expect(latestOf(OA_UPD, D(MSG), PHASE)?.toISOString()).toBe(MSG);
  });

  it("不正な日時値は無視される", () => {
    expect(latestOf("", "xxx", D(WORK))?.toISOString()).toBe(WORK);
  });
});
