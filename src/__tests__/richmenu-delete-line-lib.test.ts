/**
 * src/__tests__/richmenu-delete-line-lib.test.ts
 *
 * 「CMS で削除したのに LINE アプリには古いリッチメニューが表示され続ける」
 * 事故（D.O.T / 2026-08）の再発防止テスト（lib 層）。
 *
 * deleteRichMenuFromLine() — デフォルト解除 → メニュー削除の順序と条件:
 *   - 削除対象がデフォルトのときだけ解除する
 *   - OA Manager 所有 (403) のデフォルトには触らない
 *   - per-user リンクを無差別に解除しない
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ────────────────────────────────────────────────
// 1. lib: deleteRichMenuFromLine
// ────────────────────────────────────────────────

import { deleteRichMenuFromLine, getDefaultRichMenuState } from "@/lib/line-richmenu";

type Call = { url: string; method: string };

/**
 * fetch をスタブし、呼ばれた (url, method) を記録する。
 * @param routes URL の部分一致 → Response を返すハンドラ
 */
function stubFetch(routes: (call: Call) => { status: number; body?: string }) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string }) => {
    const call = { url: String(url), method: init?.method ?? "GET" };
    calls.push(call);
    const { status, body } = routes(call);
    return new Response(body ?? "", { status });
  }));
  return calls;
}

const TOKEN = "test-token";
const TARGET = "richmenu-target";

describe("deleteRichMenuFromLine()", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("削除対象がデフォルトのとき、デフォルト解除 → メニュー削除の順に呼ぶ", async () => {
    const calls = stubFetch((c) => {
      if (c.url.endsWith("/user/all/richmenu") && c.method === "GET") {
        return { status: 200, body: JSON.stringify({ richMenuId: TARGET }) };
      }
      return { status: 200, body: "{}" };
    });

    const result = await deleteRichMenuFromLine({ token: TOKEN, lineRichMenuId: TARGET });

    expect(result.defaultCancelled).toBe(true);
    expect(result.alreadyAbsent).toBe(false);
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.line.me/v2/bot", "")}`)).toEqual([
      "GET /user/all/richmenu",
      "DELETE /user/all/richmenu",
      `DELETE /richmenu/${TARGET}`,
    ]);
  });

  it("削除対象がデフォルトでないとき、デフォルト解除を呼ばない（他メニューを巻き込まない）", async () => {
    const calls = stubFetch((c) => {
      if (c.url.endsWith("/user/all/richmenu") && c.method === "GET") {
        return { status: 200, body: JSON.stringify({ richMenuId: "richmenu-other" }) };
      }
      return { status: 200, body: "{}" };
    });

    const result = await deleteRichMenuFromLine({ token: TOKEN, lineRichMenuId: TARGET });

    expect(result.defaultCancelled).toBe(false);
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/user/all/richmenu"))).toBe(false);
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith(`/richmenu/${TARGET}`))).toBe(true);
  });

  it("デフォルトが OA Manager 所有 (403) のとき、デフォルトに一切触らない", async () => {
    const calls = stubFetch((c) => {
      if (c.url.endsWith("/user/all/richmenu") && c.method === "GET") {
        return { status: 403, body: JSON.stringify({ message: "the richmenu is owned by another channel" }) };
      }
      return { status: 200, body: "{}" };
    });

    const result = await deleteRichMenuFromLine({ token: TOKEN, lineRichMenuId: TARGET });

    expect(result.defaultCancelled).toBe(false);
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/user/all/richmenu"))).toBe(false);
  });

  it("デフォルト未設定 (404) でも例外にせず、メニュー削除に進む", async () => {
    const calls = stubFetch((c) => {
      if (c.url.endsWith("/user/all/richmenu") && c.method === "GET") {
        return { status: 404, body: JSON.stringify({ message: "no default richmenu" }) };
      }
      return { status: 200, body: "{}" };
    });

    const result = await deleteRichMenuFromLine({ token: TOKEN, lineRichMenuId: TARGET });

    expect(result.defaultCancelled).toBe(false);
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith(`/richmenu/${TARGET}`))).toBe(true);
  });

  it("LINE 側に既に存在しない (404) 場合は冪等に成功扱いする", async () => {
    stubFetch((c) => {
      if (c.url.endsWith("/user/all/richmenu") && c.method === "GET") return { status: 404, body: "{}" };
      if (c.method === "DELETE") return { status: 404, body: JSON.stringify({ message: "not found" }) };
      return { status: 200, body: "{}" };
    });

    const result = await deleteRichMenuFromLine({ token: TOKEN, lineRichMenuId: TARGET });
    expect(result.alreadyAbsent).toBe(true);
  });

  it("メニュー削除が失敗したら LINE のエラーメッセージ付きで throw する", async () => {
    stubFetch((c) => {
      if (c.url.endsWith("/user/all/richmenu") && c.method === "GET") return { status: 404, body: "{}" };
      if (c.method === "DELETE") return { status: 500, body: JSON.stringify({ message: "internal error" }) };
      return { status: 200, body: "{}" };
    });

    await expect(deleteRichMenuFromLine({ token: TOKEN, lineRichMenuId: TARGET }))
      .rejects.toThrow(/internal error/);
  });

  it("per-user リンク (/user/{userId}/richmenu) を無差別に解除しない", async () => {
    const calls = stubFetch((c) => {
      if (c.url.endsWith("/user/all/richmenu") && c.method === "GET") {
        return { status: 200, body: JSON.stringify({ richMenuId: TARGET }) };
      }
      return { status: 200, body: "{}" };
    });

    await deleteRichMenuFromLine({ token: TOKEN, lineRichMenuId: TARGET });

    // "/user/all/richmenu" 以外の "/user/.../richmenu" を叩いていないこと
    const perUser = calls.filter(
      (c) => /\/user\/[^/]+\/richmenu/.test(c.url) && !c.url.includes("/user/all/richmenu"),
    );
    expect(perUser).toEqual([]);
  });
});

describe("getDefaultRichMenuState()", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("200 / 404 / 403 をそれぞれ ours / none / other-channel に写像する", async () => {
    stubFetch(() => ({ status: 200, body: JSON.stringify({ richMenuId: "richmenu-x" }) }));
    expect(await getDefaultRichMenuState(TOKEN)).toEqual({ kind: "ours", richMenuId: "richmenu-x" });

    vi.unstubAllGlobals();
    stubFetch(() => ({ status: 404, body: "{}" }));
    expect(await getDefaultRichMenuState(TOKEN)).toEqual({ kind: "none" });

    vi.unstubAllGlobals();
    stubFetch(() => ({ status: 403, body: "{}" }));
    expect(await getDefaultRichMenuState(TOKEN)).toEqual({ kind: "other-channel" });
  });
});
