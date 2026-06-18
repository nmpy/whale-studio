/**
 * src/__tests__/timing-form-effect.test.ts
 *
 * 編集画面「演出設定」セクションヘッダーの「設定あり」バッジ判定 (timingFormHasEffect)。
 * 一覧バッジ hasAnyTiming と同義（実効果のある設定のみ true）で、編集画面の OFF と一致することの回帰。
 *
 * 背景: 継承モード廃止後、form は常に明示文字列（"immediate"/"false" 等）を持つため、
 *   旧 `!!(read_receipt_mode || typing_enabled || loading_enabled)` だと
 *   "immediate"(即時/OFF) や文字列 "false"(OFF) も truthy となり、常に「設定あり」になっていた。
 */
import { describe, it, expect } from "vitest";
import { timingFormHasEffect } from "@/app/oas/[id]/works/[workId]/messages/_form-helpers";

describe("timingFormHasEffect — OFF は設定あり扱いしない", () => {
  it("全OFF（即時 + typing=false + loading=false）→ false", () => {
    expect(timingFormHasEffect({ read_receipt_mode: "immediate", typing_enabled: "false", loading_enabled: "false" })).toBe(false);
  });
  it("空文字（inherit）→ false", () => {
    expect(timingFormHasEffect({ read_receipt_mode: "", typing_enabled: "", loading_enabled: "" })).toBe(false);
  });
  it("未指定 → false", () => {
    expect(timingFormHasEffect({})).toBe(false);
  });
  it('typing_enabled="false"（文字列だが OFF）→ false', () => {
    expect(timingFormHasEffect({ typing_enabled: "false" })).toBe(false);
  });
  it('loading_enabled="false" → false', () => {
    expect(timingFormHasEffect({ loading_enabled: "false" })).toBe(false);
  });
  it("read_receipt_mode=immediate 単独 → false", () => {
    expect(timingFormHasEffect({ read_receipt_mode: "immediate" })).toBe(false);
  });
});

describe("timingFormHasEffect — 実効果のある設定は true", () => {
  it("read delayed → true", () => expect(timingFormHasEffect({ read_receipt_mode: "delayed" })).toBe(true));
  it("read before_reply → true", () => expect(timingFormHasEffect({ read_receipt_mode: "before_reply" })).toBe(true));
  it('typing_enabled="true" → true', () => expect(timingFormHasEffect({ typing_enabled: "true" })).toBe(true));
  it('loading_enabled="true" → true', () => expect(timingFormHasEffect({ loading_enabled: "true" })).toBe(true));
});
