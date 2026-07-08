/**
 * src/__tests__/live-session-lifecycle.test.ts
 *
 * Live 公演 lifecycle（PR2a）の純ロジック / PATCH スキーマ検証。
 */
import { describe, it, expect } from "vitest";
import {
  LIVE_SESSION_STATUSES, LIVE_SESSION_STATUS_LABELS,
  patchLiveSessionSchema, isLiveSessionStatus,
} from "@/lib/live-session-lifecycle";

describe("Live session status 定数", () => {
  it("draft / active / ended の3種", () => {
    expect(LIVE_SESSION_STATUSES).toEqual(["draft", "active", "ended"]);
  });
  it("全 status に label がある", () => {
    for (const s of LIVE_SESSION_STATUSES) {
      expect(LIVE_SESSION_STATUS_LABELS[s]).toBeTruthy();
    }
  });
});

describe("isLiveSessionStatus", () => {
  it("有効な status のみ true", () => {
    expect(isLiveSessionStatus("active")).toBe(true);
    expect(isLiveSessionStatus("ended")).toBe(true);
    expect(isLiveSessionStatus("bogus")).toBe(false);
    expect(isLiveSessionStatus(null)).toBe(false);
  });
});

describe("patchLiveSessionSchema", () => {
  it("status を受理（draft→active→ended）", () => {
    expect(patchLiveSessionSchema.safeParse({ status: "active" }).success).toBe(true);
    expect(patchLiveSessionSchema.safeParse({ status: "ended" }).success).toBe(true);
    expect(patchLiveSessionSchema.safeParse({ status: "draft" }).success).toBe(true);
  });
  it("name / starts_at / ends_at を受理", () => {
    expect(patchLiveSessionSchema.safeParse({ name: "ベルキッシュ 1回目" }).success).toBe(true);
    expect(patchLiveSessionSchema.safeParse({ starts_at: "2026-07-08T10:00:00.000Z" }).success).toBe(true);
    expect(patchLiveSessionSchema.safeParse({ ends_at: null }).success).toBe(true);
  });
  it("空 body（フィールドなし）は reject", () => {
    expect(patchLiveSessionSchema.safeParse({}).success).toBe(false);
  });
  it("不正な status は reject", () => {
    expect(patchLiveSessionSchema.safeParse({ status: "running" }).success).toBe(false);
  });
  it("不正な日時は reject", () => {
    expect(patchLiveSessionSchema.safeParse({ starts_at: "not-a-date" }).success).toBe(false);
  });
});
