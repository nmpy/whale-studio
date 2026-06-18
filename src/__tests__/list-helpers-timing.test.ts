/**
 * src/__tests__/list-helpers-timing.test.ts
 *
 * メッセージ一覧「演出: 設定あり」バッジ判定 (hasAnyTiming) の検証。
 * 編集画面の ON/OFF と一致すること（即時/inherit/明示OFFは「設定あり」にしない）の回帰。
 */
import { describe, it, expect } from "vitest";
import { hasAnyTiming, summarizeTiming } from "@/app/oas/[id]/works/[workId]/messages/_list-helpers";

describe("hasAnyTiming — OFF状態は false（編集画面と一致）", () => {
  it("全てデフォルト/未設定 → false", () => {
    expect(hasAnyTiming({})).toBe(false);
  });
  it("既読 即時(immediate) は OFF扱い → false", () => {
    expect(hasAnyTiming({ read_receipt_mode: "immediate" })).toBe(false);
  });
  it("既読 inherit → false", () => {
    expect(hasAnyTiming({ read_receipt_mode: "inherit" })).toBe(false);
  });
  it("typing/loading が明示 false（OFF）→ false", () => {
    expect(hasAnyTiming({ typing_enabled: false, loading_enabled: false })).toBe(false);
  });
  it("enabled=false でも min/max/threshold 残存値だけでは false", () => {
    expect(hasAnyTiming({
      typing_enabled: false, typing_min_ms: 800, typing_max_ms: 1500,
      loading_enabled: false, loading_threshold_ms: 1000, loading_min_seconds: 5, loading_max_seconds: 10,
    })).toBe(false);
  });
  it("即時 + read_delay_ms 残存値だけでは false", () => {
    expect(hasAnyTiming({ read_receipt_mode: "immediate", read_delay_ms: 3000 })).toBe(false);
  });
  it("lag_ms=0 → false", () => {
    expect(hasAnyTiming({ lag_ms: 0 })).toBe(false);
  });
});

describe("hasAnyTiming — 実際に効果ありは true", () => {
  it("lag_ms>0 → true", () => expect(hasAnyTiming({ lag_ms: 1000 })).toBe(true));
  it("既読 delayed → true", () => expect(hasAnyTiming({ read_receipt_mode: "delayed" })).toBe(true));
  it("既読 before_reply → true", () => expect(hasAnyTiming({ read_receipt_mode: "before_reply" })).toBe(true));
  it("typing_enabled=true → true", () => expect(hasAnyTiming({ typing_enabled: true })).toBe(true));
  it("loading_enabled=true → true", () => expect(hasAnyTiming({ loading_enabled: true })).toBe(true));
});

describe("summarizeTiming — 即時は効果として列挙しない", () => {
  it("即時は '即時' を出さない", () => {
    expect(summarizeTiming({ read_receipt_mode: "immediate" })).not.toContain("即時");
  });
  it("delayed は既読遅延を列挙", () => {
    expect(summarizeTiming({ read_receipt_mode: "delayed", read_delay_ms: 3000 })).toContain("既読遅延");
  });
});
