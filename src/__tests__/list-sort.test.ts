// src/__tests__/list-sort.test.ts
// 一覧の日時ソート共通ヘルパー（アカウント一覧 / 作品一覧が使用）の検証。
import { describe, it, expect } from "vitest";
import {
  toTimeMs,
  compareByTime,
  compareByUpdatedThenCreated,
  compareByCreated,
  compareByLatestActivity,
  activityTimeOf,
  sortByLatestActivity,
} from "@/lib/list-sort";

const T = {
  old:  "2026-01-01T00:00:00.000Z",
  mid:  "2026-03-15T12:30:00.000Z",
  new:  "2026-07-04T09:00:00.000Z",
};

/** 表示日時（updated ?? created）でソートし、id 配列を返す（実画面の tie-break を再現）。 */
function sortByUpdated(items: { id: string; updated_at?: string | null; created_at?: string | null }[], dir: "desc" | "asc" = "desc") {
  return [...items].sort((a, b) => {
    const c = compareByUpdatedThenCreated(a, b, dir);
    return c !== 0 ? c : a.id.localeCompare(b.id);
  }).map((x) => x.id);
}

describe("toTimeMs", () => {
  it("ISO 文字列 → epoch ms（文字列比較でなく数値）", () => {
    expect(toTimeMs(T.old)).toBe(new Date(T.old).getTime());
  });
  it("null / undefined / 空 / 不正値 → null", () => {
    expect(toTimeMs(null)).toBeNull();
    expect(toTimeMs(undefined)).toBeNull();
    expect(toTimeMs("")).toBeNull();
    expect(toTimeMs("not-a-date")).toBeNull();
  });
});

describe("compareByTime — null は常に末尾", () => {
  it("desc: 新しい順", () => {
    expect(compareByTime(2, 1, "desc")).toBeLessThan(0);   // a(2) が先
    expect(compareByTime(1, 2, "desc")).toBeGreaterThan(0);
  });
  it("asc: 古い順", () => {
    expect(compareByTime(1, 2, "asc")).toBeLessThan(0);    // a(1) が先
    expect(compareByTime(2, 1, "asc")).toBeGreaterThan(0);
  });
  it("null は desc / asc いずれでも末尾（正の値で後ろへ）", () => {
    expect(compareByTime(null, 1, "desc")).toBe(1);
    expect(compareByTime(null, 1, "asc")).toBe(1);
    expect(compareByTime(1, null, "desc")).toBe(-1);
    expect(compareByTime(1, null, "asc")).toBe(-1);
    expect(compareByTime(null, null, "desc")).toBe(0);
  });
});

describe("最終更新（updated_at ?? created_at）ソート", () => {
  const items = [
    { id: "a", updated_at: T.old },
    { id: "b", updated_at: T.new },
    { id: "c", updated_at: T.mid },
  ];

  it("最終更新が新しい順: updated 降順", () => {
    expect(sortByUpdated(items, "desc")).toEqual(["b", "c", "a"]);
  });

  it("最終更新が古い順: updated 昇順", () => {
    expect(sortByUpdated(items, "asc")).toEqual(["a", "c", "b"]);
  });

  it("updated_at が無い場合は created_at にフォールバック（表示と一致）", () => {
    const withFallback = [
      { id: "x", updated_at: null, created_at: T.new },
      { id: "y", updated_at: T.old, created_at: T.old },
    ];
    // x は created=T.new で最新扱い → 新しい順で先頭
    expect(sortByUpdated(withFallback, "desc")).toEqual(["x", "y"]);
  });

  it("updated_at も created_at も無い行は新しい順で末尾", () => {
    const withNull = [
      { id: "n", updated_at: null, created_at: null },
      { id: "p", updated_at: T.old },
      { id: "q", updated_at: T.new },
    ];
    expect(sortByUpdated(withNull, "desc")).toEqual(["q", "p", "n"]);
  });

  it("古い順でも null 行は末尾（先頭に来ない）", () => {
    const withNull = [
      { id: "n", updated_at: null, created_at: null },
      { id: "p", updated_at: T.old },
      { id: "q", updated_at: T.new },
    ];
    expect(sortByUpdated(withNull, "asc")).toEqual(["p", "q", "n"]);
  });

  it("同一日時でも id で安定（順不同にならない）", () => {
    const sameTime = [
      { id: "c", updated_at: T.mid },
      { id: "a", updated_at: T.mid },
      { id: "b", updated_at: T.mid },
    ];
    expect(sortByUpdated(sameTime, "desc")).toEqual(["a", "b", "c"]);
    expect(sortByUpdated(sameTime, "asc")).toEqual(["a", "b", "c"]);
  });

  it("元配列を破壊しない（非破壊コピー前提）", () => {
    const src = [{ id: "a", updated_at: T.old }, { id: "b", updated_at: T.new }];
    const snapshot = src.map((x) => x.id);
    sortByUpdated(src, "desc");
    expect(src.map((x) => x.id)).toEqual(snapshot);
  });
});

describe("最終更新 = latest_activity_at（配下の最新編集を含む）ソート", () => {
  // latest_activity_at ?? updated_at ?? created_at を基準にする（表示と一致）。
  const sortByActivity = (
    items: { id: string; latest_activity_at?: string | null; updated_at?: string | null; created_at?: string | null }[],
    dir: "desc" | "asc" = "desc",
  ) => [...items].sort((a, b) => {
    const c = compareByLatestActivity(a, b, dir);
    return c !== 0 ? c : a.id.localeCompare(b.id);
  }).map((x) => x.id);

  it("activityTimeOf は latest_activity_at を最優先（updated/created より）", () => {
    expect(activityTimeOf({ latest_activity_at: T.new, updated_at: T.old, created_at: T.old }))
      .toBe(new Date(T.new).getTime());
    // latest 欠落時は updated、さらに欠落時は created
    expect(activityTimeOf({ updated_at: T.mid, created_at: T.old })).toBe(new Date(T.mid).getTime());
    expect(activityTimeOf({ created_at: T.old })).toBe(new Date(T.old).getTime());
  });

  it("Oa.updatedAt が古くても、配下編集の latest_activity_at が新しければ上位に来る（本件のケース）", () => {
    // a: アカウント本体は 6/20 更新だが配下を今日(=T.new)編集 → latest_activity_at=T.new
    // b: 本体も配下も古い
    const items = [
      { id: "b", latest_activity_at: T.old,  updated_at: T.old, created_at: T.old },
      { id: "a", latest_activity_at: T.new,  updated_at: T.mid, created_at: T.old },
    ];
    expect(sortByActivity(items, "desc")).toEqual(["a", "b"]);
  });

  it("最終更新が新しい順 / 古い順", () => {
    const items = [
      { id: "a", latest_activity_at: T.old },
      { id: "b", latest_activity_at: T.new },
      { id: "c", latest_activity_at: T.mid },
    ];
    expect(sortByActivity(items, "desc")).toEqual(["b", "c", "a"]);
    expect(sortByActivity(items, "asc")).toEqual(["a", "c", "b"]);
  });

  it("latest_activity_at 欠落は updated→created にフォールバック（表示と一致）", () => {
    const items = [
      { id: "x", updated_at: null, created_at: T.new },   // created にフォールバック
      { id: "y", latest_activity_at: T.old },
    ];
    expect(sortByActivity(items, "desc")).toEqual(["x", "y"]);
  });

  it("同一活動日時でも id で安定", () => {
    const items = [
      { id: "c", latest_activity_at: T.mid },
      { id: "a", latest_activity_at: T.mid },
      { id: "b", latest_activity_at: T.mid },
    ];
    expect(sortByActivity(items, "desc")).toEqual(["a", "b", "c"]);
  });
});

describe("sortByLatestActivity — アカウントカード内の作品の並び（最終更新が新しい順）", () => {
  it("今日更新した作品 A が、過去更新の作品 B より上に来る（本件のケース）", () => {
    const works = [
      { id: "B", title: "みなさん自由に", latest_activity_at: T.old, created_at: "2026-04-02T00:00:00.000Z" },
      { id: "A", title: "既読無視しないで。", latest_activity_at: T.new, created_at: "2026-04-01T00:00:00.000Z" },
    ];
    expect(sortByLatestActivity(works).map((w) => w.id)).toEqual(["A", "B"]);
  });

  it("Phase/Message 更新が latest_activity_at に載っていれば、その作品が上に来る", () => {
    // 作品 C は work.updatedAt は古いが、配下編集で latest_activity_at=T.new
    const works = [
      { id: "old", latest_activity_at: T.mid, updated_at: T.mid, created_at: T.old },
      { id: "C",   latest_activity_at: T.new, updated_at: T.old, created_at: T.old },
    ];
    expect(sortByLatestActivity(works)[0].id).toBe("C");
  });

  it("latest_activity_at 欠落は updated→created にフォールバック（表示と一致）", () => {
    const works = [
      { id: "x", updated_at: null, created_at: T.new },
      { id: "y", latest_activity_at: T.old },
    ];
    expect(sortByLatestActivity(works).map((w) => w.id)).toEqual(["x", "y"]);
  });

  it("作品0件・1件でも壊れない（非破壊）", () => {
    expect(sortByLatestActivity([])).toEqual([]);
    const one = [{ id: "only", latest_activity_at: T.mid }];
    const out = sortByLatestActivity(one);
    expect(out.map((w) => w.id)).toEqual(["only"]);
    expect(out).not.toBe(one); // コピーを返す
  });

  it("同一活動日時は id で安定", () => {
    const works = [
      { id: "c", latest_activity_at: T.mid },
      { id: "a", latest_activity_at: T.mid },
      { id: "b", latest_activity_at: T.mid },
    ];
    expect(sortByLatestActivity(works).map((w) => w.id)).toEqual(["a", "b", "c"]);
  });
});

describe("作成日時（created_at）ソート", () => {
  const items = [
    { id: "a", created_at: T.old },
    { id: "b", created_at: T.new },
    { id: "c", created_at: T.mid },
  ];
  const byCreated = (dir: "desc" | "asc") =>
    [...items].sort((a, b) => { const c = compareByCreated(a, b, dir); return c !== 0 ? c : a.id.localeCompare(b.id); }).map((x) => x.id);

  it("作成日時が新しい順: created 降順", () => {
    expect(byCreated("desc")).toEqual(["b", "c", "a"]);
  });
  it("作成日時が古い順: created 昇順", () => {
    expect(byCreated("asc")).toEqual(["a", "c", "b"]);
  });
});
