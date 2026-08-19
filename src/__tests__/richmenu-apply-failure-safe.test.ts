/**
 * src/__tests__/richmenu-apply-failure-safe.test.ts
 *
 * リッチメニュー適用（applyRichMenuConfig）の **failure-path** を固定する。
 *
 * ## 何を防いでいるか（2026-08-19 の本番障害）
 *
 * 旧実装は「最初に旧メニューを削除」し「画像アップロード失敗を console.warn で無視」して
 * default 化へ進んでいた。画像が 3.09MB（LINE 上限 1MB）だったため:
 *
 *   旧 delete → 新 create → 画像 413（warn のみ）→ setDefault 400 → route 500
 *   → DB 更新に到達せず
 *
 * となり、**LINE default = なし / DB = 既に削除済みの ID** が固定された。
 * D.O.T の利用者にリッチメニューが表示されなくなった。
 *
 * ## 不変条件
 *
 *   1. 新メニューが完全に利用可能になるまで、利用中の旧メニューを削除しない
 *   2. 画像アップロード失敗を非致命的にしない（setDefault へ進ませない）
 *   3. どの失敗段でも「LINE default = none + DB = LINE に無い ID」を作れない
 */
import { describe, it, expect, vi } from "vitest";
import {
  applyRichMenuConfig,
  RichMenuApplyError,
  RICH_MENU_IMAGE_MAX_BYTES,
  type RichMenuApplyDeps,
  type RichMenuConfig,
} from "@/lib/line-richmenu";

const TOKEN = "test-token";
const OLD_ID = "richmenu-old";
const NEW_ID = "richmenu-new";

const CONFIG: RichMenuConfig = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "テストメニュー",
  chatBarText: "メニュー",
  areas: [
    { bounds: { x: 0, y: 0, width: 2500, height: 1686 }, action: { type: "message", label: "a", text: "a" } },
  ],
};

/** 呼び出し順を記録しながら成功する deps。個別に上書きして failure を作る。 */
function makeDeps(over: Partial<RichMenuApplyDeps> = {}) {
  const calls: string[] = [];
  /** LINE 側の状態を模す。 */
  const state = {
    menus: new Set<string>([OLD_ID]),
    images: new Set<string>([OLD_ID]),
    defaultId: OLD_ID as string | null,
  };

  const deps: RichMenuApplyDeps = {
    createRichMenu: vi.fn(async () => {
      calls.push("create");
      state.menus.add(NEW_ID);
      return NEW_ID;
    }),
    uploadRichMenuImage: vi.fn(async (_t, id) => {
      calls.push("upload");
      state.images.add(id);
    }),
    setDefaultRichMenu: vi.fn(async (_t, id) => {
      calls.push(`setDefault:${id}`);
      state.defaultId = id;
    }),
    getDefaultRichMenuId: vi.fn(async () => {
      calls.push("getDefault");
      return state.defaultId;
    }),
    richMenuExists: vi.fn(async (_t, id) => {
      calls.push(`exists:${id}`);
      return state.menus.has(id);
    }),
    richMenuImageExists: vi.fn(async (_t, id) => {
      calls.push(`imageExists:${id}`);
      return state.images.has(id);
    }),
    deleteRichMenu: vi.fn(async (_t, id) => {
      calls.push(`delete:${id}`);
      state.menus.delete(id);
      state.images.delete(id);
    }),
    fetchImage: vi.fn(async () => {
      calls.push("fetchImage");
      return { buffer: Buffer.alloc(1000), mimeType: "image/png" };
    }),
    ...over,
  };
  return { deps, calls, state };
}

const baseArgs = {
  token: TOKEN,
  config: CONFIG,
  imageUrl: "https://example.test/menu.png",
  oldLineRichMenuId: OLD_ID,
  logPrefix: "[test]",
};

/** 各失敗ケースで共通に成立すべき不変条件。 */
function expectNoBrokenState(calls: string[], state: { defaultId: string | null }, persist: ReturnType<typeof vi.fn>) {
  // 旧メニューは削除されていない
  expect(calls).not.toContain(`delete:${OLD_ID}`);
  // DB は更新されていない
  expect(persist).not.toHaveBeenCalled();
  // default は none になっていない（旧が残っている）
  expect(state.defaultId).toBe(OLD_ID);
}

describe("Test 1 — 正常成功時の順序", () => {
  it("create → upload → verify → setDefault → verify → DB → 旧 delete の順になる", async () => {
    const { deps, calls, state } = makeDeps();
    const persist = vi.fn(async () => { calls.push("persist"); });

    const res = await applyRichMenuConfig({ ...baseArgs, persist, deps });

    expect(res.lineRichMenuId).toBe(NEW_ID);
    expect(res.imageUploaded).toBe(true);
    expect(res.oldMenuDeleted).toBe(true);

    const order = calls.filter((c) =>
      c === "create" || c === "upload" || c === "persist" ||
      c === `setDefault:${NEW_ID}` || c === `delete:${OLD_ID}` || c === `imageExists:${NEW_ID}`);
    expect(order).toEqual([
      "create",
      "upload",
      `imageExists:${NEW_ID}`,
      `setDefault:${NEW_ID}`,
      "persist",
      `delete:${OLD_ID}`,
    ]);

    // 旧 delete は create より後（= 置き換え成功後の cleanup）
    expect(calls.indexOf(`delete:${OLD_ID}`)).toBeGreaterThan(calls.indexOf("create"));
    // 最終状態: default = 新
    expect(state.defaultId).toBe(NEW_ID);
  });
});

describe("Test 2 — create failure", () => {
  it("旧 delete / DB / setDefault いずれも呼ばれない", async () => {
    const { deps, calls, state } = makeDeps({
      createRichMenu: vi.fn(async () => { throw new Error("LINE API HTTP 500"); }),
    });
    const persist = vi.fn();

    await expect(applyRichMenuConfig({ ...baseArgs, persist, deps })).rejects.toThrow(RichMenuApplyError);

    expect(calls.filter((c) => c.startsWith("setDefault"))).toHaveLength(0);
    expect(calls.filter((c) => c.startsWith("delete"))).toHaveLength(0);
    expectNoBrokenState(calls, state, persist);
  });
});

describe("Test 3 — image upload failure（今回の障害の入口）", () => {
  it("setDefault / DB / 旧 delete に進まず、新 orphan は cleanup される", async () => {
    const { deps, calls, state } = makeDeps({
      uploadRichMenuImage: vi.fn(async () => { throw new Error("LINE API HTTP 413"); }),
    });
    const persist = vi.fn();

    const err = await applyRichMenuConfig({ ...baseArgs, persist, deps }).catch((e) => e);
    expect(err).toBeInstanceOf(RichMenuApplyError);
    expect(err.stage).toBe("image_upload");

    // 最重要: 画像失敗のあと setDefault へ進んでいない
    expect(calls.filter((c) => c.startsWith("setDefault"))).toHaveLength(0);
    // 新 orphan は cleanup 済み
    expect(calls).toContain(`delete:${NEW_ID}`);
    expect(err.cleanup).toEqual({ attempted: true, ok: true });
    expect(state.menus.has(NEW_ID)).toBe(false);

    expectNoBrokenState(calls, state, persist);
  });

  it("画像 fetch 失敗も致命的（create すら行わない）", async () => {
    const { deps, calls, state } = makeDeps({
      fetchImage: vi.fn(async () => { throw new Error("HTTP 404"); }),
    });
    const persist = vi.fn();

    const err = await applyRichMenuConfig({ ...baseArgs, persist, deps }).catch((e) => e);
    expect(err.stage).toBe("image_fetch");
    expect(calls).not.toContain("create");
    expectNoBrokenState(calls, state, persist);
  });
});

describe("Test 4 — setDefault failure", () => {
  it("DB / 旧 delete は行われず、新メニューが cleanup される", async () => {
    const { deps, calls, state } = makeDeps({
      setDefaultRichMenu: vi.fn(async () => { throw new Error("LINE API HTTP 400"); }),
    });
    const persist = vi.fn();

    const err = await applyRichMenuConfig({ ...baseArgs, persist, deps }).catch((e) => e);
    expect(err.stage).toBe("set_default");
    expect(err.cleanup?.ok).toBe(true);
    expect(calls).toContain(`delete:${NEW_ID}`);
    expectNoBrokenState(calls, state, persist);
  });

  it("setDefault が 200 でも default が反映されていなければ失敗扱いにする", async () => {
    // setDefault は成功を返すが LINE 側の default が変わらないケース。
    const { deps, calls, state } = makeDeps({
      setDefaultRichMenu: vi.fn(async () => { /* 200 を返すだけで反映しない */ }),
    });
    const persist = vi.fn();

    const err = await applyRichMenuConfig({ ...baseArgs, persist, deps }).catch((e) => e);
    expect(err.stage).toBe("verify_default");
    expect(calls).toContain(`delete:${NEW_ID}`);
    expect(persist).not.toHaveBeenCalled();
    expect(calls).not.toContain(`delete:${OLD_ID}`);
    expect(state.defaultId).toBe(OLD_ID);
  });
});

describe("Test 5 — setDefault 成功後の DB update failure", () => {
  it("旧 default へ rollback し、新メニューを cleanup し、旧 delete はしない", async () => {
    const { deps, calls, state } = makeDeps();
    const persist = vi.fn(async () => { throw new Error("DB connection lost"); });

    const err = await applyRichMenuConfig({ ...baseArgs, persist, deps }).catch((e) => e);
    expect(err).toBeInstanceOf(RichMenuApplyError);
    expect(err.stage).toBe("persist");

    // 旧 default へ戻っている
    expect(err.rollback).toEqual({ attempted: true, ok: true });
    expect(calls).toContain(`setDefault:${OLD_ID}`);
    expect(state.defaultId).toBe(OLD_ID);

    // 新メニューは cleanup、旧メニューは残す
    expect(err.cleanup?.ok).toBe(true);
    expect(calls).toContain(`delete:${NEW_ID}`);
    expect(calls).not.toContain(`delete:${OLD_ID}`);
    expect(state.menus.has(OLD_ID)).toBe(true);
  });
});

describe("Test 6 — rollback failure", () => {
  it("primary error（persist 失敗）を保持したまま rollback failure を記録する", async () => {
    const base = makeDeps();
    // 新 ID への setDefault は成功。旧 default へ戻そうとすると失敗する。
    const { deps } = makeDeps({
      setDefaultRichMenu: vi.fn(async (_t, id) => {
        if (id === OLD_ID) throw new Error("LINE API HTTP 500");
        await base.deps.setDefaultRichMenu(_t, id);
      }),
      getDefaultRichMenuId: base.deps.getDefaultRichMenuId,
      richMenuExists: base.deps.richMenuExists,
      richMenuImageExists: base.deps.richMenuImageExists,
      createRichMenu: base.deps.createRichMenu,
      uploadRichMenuImage: base.deps.uploadRichMenuImage,
      deleteRichMenu: base.deps.deleteRichMenu,
      fetchImage: base.deps.fetchImage,
    });
    const persist = vi.fn(async () => { throw new Error("DB connection lost"); });

    const err = await applyRichMenuConfig({ ...baseArgs, persist, deps }).catch((e) => e);

    // primary error は persist 段のまま（rollback error に置き換わらない）
    expect(err.stage).toBe("persist");
    expect(err.rollback).toMatchObject({ attempted: true, ok: false });
    expect(err.rollback?.error).toContain("500");
    // 運用者向け文言も「復帰も失敗」を伝える
    expect(err.operatorMessage).toContain("復帰も失敗");
  });

  it("cleanup failure も primary error を上書きしない", async () => {
    const { deps } = makeDeps({
      uploadRichMenuImage: vi.fn(async () => { throw new Error("LINE API HTTP 413"); }),
      deleteRichMenu: vi.fn(async () => { throw new Error("delete 500"); }),
    });

    const err = await applyRichMenuConfig({ ...baseArgs, deps }).catch((e) => e);
    // primary は画像アップロード失敗
    expect(err.stage).toBe("image_upload");
    expect(err.cleanup).toMatchObject({ attempted: true, ok: false });
    expect(err.cleanup?.error).toContain("delete 500");
  });
});

describe("Test 7 — 旧メニュー cleanup failure は apply 成功扱い", () => {
  it("置き換えは完了しているので成功を返し、warning に載せる（新 default は戻さない）", async () => {
    const { deps, calls, state } = makeDeps({
      deleteRichMenu: vi.fn(async (_t, id) => {
        if (id === OLD_ID) throw new Error("delete 500");
      }),
    });
    const persist = vi.fn(async () => {});

    const res = await applyRichMenuConfig({ ...baseArgs, persist, deps });

    expect(res.lineRichMenuId).toBe(NEW_ID);
    expect(res.oldMenuDeleted).toBe(false);
    expect(res.warnings?.join(" ")).toContain("旧リッチメニューの削除に失敗");
    // ユーザー影響がない cleanup 失敗で新 default を戻さない
    expect(state.defaultId).toBe(NEW_ID);
    expect(calls).not.toContain(`setDefault:${OLD_ID}`);
    expect(persist).toHaveBeenCalledOnce();
  });
});

describe("Test 8 — 画像サイズの境界値", () => {
  it(`ちょうど上限 (${RICH_MENU_IMAGE_MAX_BYTES}) は PASS`, async () => {
    const { deps } = makeDeps({
      fetchImage: vi.fn(async () => ({ buffer: Buffer.alloc(RICH_MENU_IMAGE_MAX_BYTES), mimeType: "image/png" })),
    });
    const res = await applyRichMenuConfig({ ...baseArgs, deps });
    expect(res.imageUploaded).toBe(true);
  });

  it(`上限 + 1 byte は送信前に FAIL（LINE を叩かない）`, async () => {
    const { deps, calls, state } = makeDeps({
      fetchImage: vi.fn(async () => ({ buffer: Buffer.alloc(RICH_MENU_IMAGE_MAX_BYTES + 1), mimeType: "image/png" })),
    });
    const persist = vi.fn();

    const err = await applyRichMenuConfig({ ...baseArgs, persist, deps }).catch((e) => e);
    expect(err.stage).toBe("image_validation");
    // 一次原因が運用者に分かる文言であること（LINE の二次 400 ではない）
    expect(err.operatorMessage).toContain("1MB以下");
    // LINE API を一切叩いていない
    expect(calls).not.toContain("create");
    expect(calls).not.toContain("upload");
    expectNoBrokenState(calls, state, persist);
  });

  it("実際の障害サイズ 3.09MB も同様に送信前に FAIL", async () => {
    const { deps, calls } = makeDeps({
      fetchImage: vi.fn(async () => ({ buffer: Buffer.alloc(3_243_431), mimeType: "image/png" })),
    });
    const err = await applyRichMenuConfig({ ...baseArgs, deps }).catch((e) => e);
    expect(err.stage).toBe("image_validation");
    expect(err.operatorMessage).toContain("3.09MB");
    expect(calls).not.toContain("create");
  });

  it("非対応 MIME も送信前に FAIL", async () => {
    const { deps, calls } = makeDeps({
      fetchImage: vi.fn(async () => ({ buffer: Buffer.alloc(1000), mimeType: "image/webp" })),
    });
    const err = await applyRichMenuConfig({ ...baseArgs, deps }).catch((e) => e);
    expect(err.stage).toBe("image_validation");
    expect(err.operatorMessage).toContain("PNG または JPEG");
    expect(calls).not.toContain("create");
  });
});

describe("Test 10 — DB が LINE に存在しない ID を指している（stale 参照）", () => {
  it("旧メニューの delete を試みず、apply を完走できる", async () => {
    const { deps, calls, state } = makeDeps();
    // LINE 上に旧メニューが無い状態（過去の apply 途中失敗の後）
    state.menus.delete(OLD_ID);
    state.images.delete(OLD_ID);
    state.defaultId = null;
    const persist = vi.fn(async () => {});

    const res = await applyRichMenuConfig({ ...baseArgs, persist, deps });

    expect(res.oldMenuMissingOnLine).toBe(true);
    expect(res.oldMenuDeleted).toBe(false);
    // 存在しない旧 ID を消しに行かない
    expect(calls).not.toContain(`delete:${OLD_ID}`);
    // 置き換えは完了している
    expect(state.defaultId).toBe(NEW_ID);
    expect(persist).toHaveBeenCalledWith(NEW_ID);
  });

  it("stale 参照 + persist 失敗でも、戻す先が無いので default を壊さない", async () => {
    const { deps, calls, state } = makeDeps();
    state.menus.delete(OLD_ID);
    state.defaultId = null; // 元から default なし
    const persist = vi.fn(async () => { throw new Error("DB down"); });

    const err = await applyRichMenuConfig({ ...baseArgs, persist, deps }).catch((e) => e);
    expect(err.stage).toBe("persist");
    // 戻す先が無いので rollback は attempted=false（default 解除もしない）
    expect(err.rollback).toEqual({ attempted: false, ok: false });
    // 新メニューは cleanup される
    expect(calls).toContain(`delete:${NEW_ID}`);
    expect(calls).not.toContain(`delete:${OLD_ID}`);
  });
});

describe("不変条件: 障害状態を apply failure から作れない", () => {
  const failures: Array<{ label: string; over: Partial<RichMenuApplyDeps>; persistFails?: boolean }> = [
    { label: "create failure", over: { createRichMenu: vi.fn(async () => { throw new Error("x"); }) } },
    { label: "image upload failure", over: { uploadRichMenuImage: vi.fn(async () => { throw new Error("413"); }) } },
    { label: "verify image failure", over: { richMenuImageExists: vi.fn(async () => false) } },
    { label: "setDefault failure", over: { setDefaultRichMenu: vi.fn(async () => { throw new Error("400"); }) } },
    { label: "DB failure", over: {}, persistFails: true },
  ];

  for (const f of failures) {
    it(`${f.label} でも「default = none + DB stale」を作らない`, async () => {
      const { deps, calls, state } = makeDeps(f.over);
      const persist = f.persistFails
        ? vi.fn(async () => { throw new Error("DB down"); })
        : vi.fn(async () => {});

      await expect(applyRichMenuConfig({ ...baseArgs, persist, deps })).rejects.toThrow();

      // default が none になっていない（= 利用者にメニューが出続ける）
      expect(state.defaultId, f.label).not.toBeNull();
      // 旧メニューが LINE 上に残っている（= default が指す先が実在する）
      expect(state.menus.has(state.defaultId as string), f.label).toBe(true);
      // 旧メニューを削除していない
      expect(calls, f.label).not.toContain(`delete:${OLD_ID}`);
    });
  }
});
