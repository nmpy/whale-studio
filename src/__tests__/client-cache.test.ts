/**
 * src/__tests__/client-cache.test.ts
 *
 * src/lib/client-cache.ts の TTL cache を検証する。
 *
 * 検証観点:
 *   - set→get で TTL 内は返る / TTL 超過は null（破棄）
 *   - 未登録は null
 *   - clear() / clearAllTtlCaches() で消える
 *   - キーが違えば独立
 */

import { describe, it, expect } from "vitest";
import { createTtlCache, clearAllTtlCaches } from "@/lib/client-cache";

describe("createTtlCache", () => {
  it("TTL 内は返る / 超過で破棄して null", () => {
    const c = createTtlCache<number>(1000);
    c.set("a", 42, 0);
    expect(c.get("a", 500)).toBe(42);      // TTL 内
    expect(c.get("a", 1000)).toBe(42);     // 境界ちょうどは有効
    expect(c.get("a", 1001)).toBeNull();   // 超過 → 破棄
    expect(c.get("a", 0)).toBeNull();      // 破棄済みは復活しない
  });

  it("未登録は null", () => {
    const c = createTtlCache<string>(1000);
    expect(c.get("missing", 0)).toBeNull();
  });

  it("キーが違えば独立", () => {
    const c = createTtlCache<string>(1000);
    c.set("x", "X", 0);
    expect(c.get("y", 0)).toBeNull();
    expect(c.get("x", 0)).toBe("X");
  });

  it("clear() で消える", () => {
    const c = createTtlCache<number>(1000);
    c.set("a", 1, 0);
    c.clear();
    expect(c.get("a", 0)).toBeNull();
  });

  it("clearAllTtlCaches() は登録済み全 cache を消す（auth 変化時）", () => {
    const c1 = createTtlCache<number>(1000);
    const c2 = createTtlCache<string>(1000);
    c1.set("a", 1, 0);
    c2.set("b", "B", 0);
    clearAllTtlCaches();
    expect(c1.get("a", 0)).toBeNull();
    expect(c2.get("b", 0)).toBeNull();
  });
});
