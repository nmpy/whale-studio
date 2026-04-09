// layout-persistence.test.ts — localStorage レイアウト永続化のテスト

import { describe, it, expect, beforeEach, vi } from "vitest";

// localStorage モック
const storageData: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => storageData[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { storageData[key] = value; }),
  removeItem: vi.fn((key: string) => { delete storageData[key]; }),
};
vi.stubGlobal("localStorage", localStorageMock);

// 永続化ロジックを直接テスト
const STORAGE_PREFIX = "ng-layout-";

function loadPositions(workId: string): Record<string, { x: number; y: number }> | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${workId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof key !== "string") return null;
      const v = val as { x?: unknown; y?: unknown };
      if (typeof v.x !== "number" || typeof v.y !== "number") return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function savePositions(workId: string, positions: Record<string, { x: number; y: number }>): void {
  localStorage.setItem(`${STORAGE_PREFIX}${workId}`, JSON.stringify(positions));
}

describe("layout persistence", () => {
  beforeEach(() => {
    for (const key of Object.keys(storageData)) delete storageData[key];
    vi.clearAllMocks();
  });

  it("saves and loads positions correctly", () => {
    const positions = { "phase-1": { x: 100, y: 200 }, "phase-2": { x: 300, y: 400 } };
    savePositions("work-1", positions);
    const loaded = loadPositions("work-1");
    expect(loaded).toEqual(positions);
  });

  it("returns null for missing data", () => {
    expect(loadPositions("nonexistent")).toBeNull();
  });

  it("returns null for corrupted JSON", () => {
    storageData[`${STORAGE_PREFIX}work-1`] = "not json";
    expect(loadPositions("work-1")).toBeNull();
  });

  it("returns null for invalid position data", () => {
    storageData[`${STORAGE_PREFIX}work-1`] = JSON.stringify({ "phase-1": { x: "bad", y: 100 } });
    expect(loadPositions("work-1")).toBeNull();
  });

  it("isolates data by workId", () => {
    savePositions("work-1", { "phase-1": { x: 10, y: 20 } });
    savePositions("work-2", { "phase-2": { x: 30, y: 40 } });
    expect(loadPositions("work-1")).toEqual({ "phase-1": { x: 10, y: 20 } });
    expect(loadPositions("work-2")).toEqual({ "phase-2": { x: 30, y: 40 } });
  });

  it("applies persisted positions to node array", () => {
    const nodes = [
      { id: "phase-1", position: { x: 0, y: 0 } },
      { id: "phase-2", position: { x: 0, y: 0 } },
      { id: "msg-1", position: { x: 0, y: 0 } },
    ];
    const saved = { "phase-1": { x: 100, y: 200 }, "phase-2": { x: 300, y: 400 } };

    const result = nodes.map(node => {
      const pos = saved[node.id as keyof typeof saved];
      return pos ? { ...node, position: pos } : node;
    });

    expect(result[0].position).toEqual({ x: 100, y: 200 });
    expect(result[1].position).toEqual({ x: 300, y: 400 });
    expect(result[2].position).toEqual({ x: 0, y: 0 }); // msg not saved
  });
});
