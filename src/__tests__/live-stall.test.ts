/**
 * src/__tests__/live-stall.test.ts
 *
 * 停滞検知 + 相対時刻表示（PR2b-2・表示側導出）の検証。
 */
import { describe, it, expect } from "vitest";
import { isParticipantStalled, formatRelativeTime, LIVE_STALL_THRESHOLD_MS } from "@/lib/live-stall";

const NOW = new Date("2026-07-09T12:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("isParticipantStalled", () => {
  it("閾値超の active/waiting/stuck は停滞", () => {
    const old = ago(LIVE_STALL_THRESHOLD_MS + 60_000);
    expect(isParticipantStalled("active", old, NOW)).toBe(true);
    expect(isParticipantStalled("waiting", old, NOW)).toBe(true);
    expect(isParticipantStalled("stuck", old, NOW)).toBe(true);
  });
  it("閾値内は非停滞", () => {
    expect(isParticipantStalled("active", ago(60_000), NOW)).toBe(false);
  });
  it("completed / dropped は常に非停滞", () => {
    const old = ago(LIVE_STALL_THRESHOLD_MS + 60_000);
    expect(isParticipantStalled("completed", old, NOW)).toBe(false);
    expect(isParticipantStalled("dropped", old, NOW)).toBe(false);
  });
  it("lastSeenAt が無い/不正は非停滞", () => {
    expect(isParticipantStalled("active", null, NOW)).toBe(false);
    expect(isParticipantStalled("active", undefined, NOW)).toBe(false);
    expect(isParticipantStalled("active", "not-a-date", NOW)).toBe(false);
  });
  it("閾値はカスタム可能", () => {
    expect(isParticipantStalled("active", ago(5_000), NOW, 1_000)).toBe(true);
    expect(isParticipantStalled("active", ago(500), NOW, 1_000)).toBe(false);
  });
});

describe("formatRelativeTime", () => {
  it("直近は たった今", () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe("たった今");
    expect(formatRelativeTime(ago(30_000), NOW)).toBe("たった今");
  });
  it("分 / 時間 / 日", () => {
    expect(formatRelativeTime(ago(5 * 60_000), NOW)).toBe("5分前");
    expect(formatRelativeTime(ago(3 * 3600_000), NOW)).toBe("3時間前");
    expect(formatRelativeTime(ago(2 * 86_400_000), NOW)).toBe("2日前");
  });
  it("null / 不正は —", () => {
    expect(formatRelativeTime(null, NOW)).toBe("—");
    expect(formatRelativeTime("bad", NOW)).toBe("—");
  });
});
