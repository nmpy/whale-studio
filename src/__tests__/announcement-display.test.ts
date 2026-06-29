// src/__tests__/announcement-display.test.ts
// /oas お知らせ表示件数 normalize の検証。
import { describe, it, expect } from "vitest";
import {
  normalizeAnnouncementLimit,
  DEFAULT_ANNOUNCEMENT_DISPLAY_LIMIT,
  MIN_ANNOUNCEMENT_DISPLAY_LIMIT,
  MAX_ANNOUNCEMENT_DISPLAY_LIMIT,
} from "@/lib/announcement-display";

describe("定数", () => {
  it("既定3 / 最小1 / 最大10", () => {
    expect(DEFAULT_ANNOUNCEMENT_DISPLAY_LIMIT).toBe(3);
    expect(MIN_ANNOUNCEMENT_DISPLAY_LIMIT).toBe(1);
    expect(MAX_ANNOUNCEMENT_DISPLAY_LIMIT).toBe(10);
  });
});

describe("normalizeAnnouncementLimit", () => {
  it("未設定/不正値は既定3", () => {
    expect(normalizeAnnouncementLimit(null)).toBe(3);
    expect(normalizeAnnouncementLimit(undefined)).toBe(3);
    expect(normalizeAnnouncementLimit(NaN)).toBe(3);
    expect(normalizeAnnouncementLimit("abc")).toBe(3);
    expect(normalizeAnnouncementLimit("")).toBe(3);
    expect(normalizeAnnouncementLimit({})).toBe(3);
    expect(normalizeAnnouncementLimit([])).toBe(3);
    expect(normalizeAnnouncementLimit(Infinity)).toBe(3);
  });
  it("0・負数・小数は既定3", () => {
    expect(normalizeAnnouncementLimit(0)).toBe(3);
    expect(normalizeAnnouncementLimit(-1)).toBe(3);
    expect(normalizeAnnouncementLimit(-10)).toBe(3);
    expect(normalizeAnnouncementLimit(2.5)).toBe(3);
    expect(normalizeAnnouncementLimit(3.9)).toBe(3);
  });
  it("1〜10はそのまま", () => {
    expect(normalizeAnnouncementLimit(1)).toBe(1);
    expect(normalizeAnnouncementLimit(3)).toBe(3);
    expect(normalizeAnnouncementLimit(5)).toBe(5);
    expect(normalizeAnnouncementLimit(10)).toBe(10);
  });
  it("11以上は10にclamp", () => {
    expect(normalizeAnnouncementLimit(11)).toBe(10);
    expect(normalizeAnnouncementLimit(100)).toBe(10);
  });
  it("整数の数値文字列も受け付ける", () => {
    expect(normalizeAnnouncementLimit("5")).toBe(5);
    expect(normalizeAnnouncementLimit("11")).toBe(10);
    expect(normalizeAnnouncementLimit("0")).toBe(3);
    expect(normalizeAnnouncementLimit("2.5")).toBe(3);
  });
});
