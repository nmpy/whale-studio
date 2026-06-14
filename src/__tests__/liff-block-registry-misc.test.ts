/**
 * src/__tests__/liff-block-registry-misc.test.ts
 *
 * LIFF ブロック整理まわりの回帰テスト:
 * - 追加メニューから start/resume/evidence を除外（registry には残置＝後方互換）
 * - 新ブロック riddle_list が validate でき、未指定でも空設定が通る
 * - 削除対象の既存ブロック設定も従来どおり validate できる（過去データ非破壊）
 */
import { describe, it, expect } from "vitest";
import { validateBlockSettings } from "@/lib/validations";

describe("validateBlockSettings(riddle_list)", () => {
  it("空設定でも success", () => {
    expect(validateBlockSettings("riddle_list", {}).success).toBe(true);
  });
  it("title/max_count/show_status を受理", () => {
    expect(validateBlockSettings("riddle_list", { title: "謎", max_count: 5, show_status: true }).success).toBe(true);
  });
  it("max_count 範囲外は失敗", () => {
    expect(validateBlockSettings("riddle_list", { max_count: 0 }).success).toBe(false);
  });
});

describe("removed-from-add-menu types は validate 可能（後方互換）", () => {
  it("start_button / resume_button / evidence_list の既存設定が通る", () => {
    expect(validateBlockSettings("start_button", {}).success).toBe(true);
    expect(validateBlockSettings("resume_button", {}).success).toBe(true);
    expect(validateBlockSettings("evidence_list", {}).success).toBe(true);
  });
});
