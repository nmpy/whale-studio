/**
 * src/__tests__/geo.test.ts
 *
 * Haversine 距離計算 + 半径判定テスト
 */

import { describe, it, expect } from "vitest";
import { getDistanceMeters, isWithinRadius } from "@/lib/geo";

describe("getDistanceMeters", () => {
  it("同一地点なら 0m", () => {
    const d = getDistanceMeters(35.6812, 139.7671, 35.6812, 139.7671);
    expect(d).toBeCloseTo(0, 0);
  });

  it("東京駅〜渋谷駅 ≈ 5.6km", () => {
    // 東京駅 35.6812, 139.7671 → 渋谷駅 35.6580, 139.7016
    const d = getDistanceMeters(35.6812, 139.7671, 35.6580, 139.7016);
    expect(d).toBeGreaterThan(5000);
    expect(d).toBeLessThan(7000);
  });

  it("赤道上 1度 ≈ 111km", () => {
    const d = getDistanceMeters(0, 0, 0, 1);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });

  it("対蹠点（地球反対側）≈ 20000km", () => {
    const d = getDistanceMeters(0, 0, 0, 180);
    expect(d).toBeGreaterThan(19_900_000);
    expect(d).toBeLessThan(20_100_000);
  });
});

describe("isWithinRadius", () => {
  // 東京タワー 35.6586, 139.7454
  const tower = { lat: 35.6586, lng: 139.7454 };

  it("半径内なら within=true", () => {
    // 約50m南の地点
    const result = isWithinRadius(35.6582, 139.7454, tower.lat, tower.lng, 100);
    expect(result.within).toBe(true);
    expect(result.distanceMeters).toBeLessThan(100);
  });

  it("半径外なら within=false", () => {
    // 東京駅（約3km離れている）
    const result = isWithinRadius(35.6812, 139.7671, tower.lat, tower.lng, 100);
    expect(result.within).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(2000);
  });

  it("境界付近（ギリギリ内）", () => {
    // 100m圏内の地点を手動計算: 緯度を約0.0009度ずらす ≈ 100m
    const result = isWithinRadius(35.6595, 139.7454, tower.lat, tower.lng, 110);
    expect(result.within).toBe(true);
    expect(result.distanceMeters).toBeGreaterThan(50);
  });

  it("同一地点なら距離 0m で within=true", () => {
    const result = isWithinRadius(tower.lat, tower.lng, tower.lat, tower.lng, 1);
    expect(result.within).toBe(true);
    expect(result.distanceMeters).toBe(0);
  });

  it("半径 0m なら同一地点以外は within=false", () => {
    const result = isWithinRadius(35.6587, 139.7454, tower.lat, tower.lng, 0);
    // 約11m 離れている
    expect(result.within).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(0);
  });
});
