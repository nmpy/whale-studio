/**
 * src/__tests__/line-reply-failure-visibility.test.ts
 *
 * reply 送信失敗の可視化。
 *
 * 背景: D.O.T のカルーセルが LINE に 400 で拒否され 3 回とも 1 通も届かなかったが、
 *   `replyToLine` が `Promise<void>` でエラーを握りつぶしていたため
 *   `[line:reply-lag:summary]` は `failures:[]` のまま「送れた」ように見えていた。
 *   運用者は Vercel のログを直接読まない限り気づけなかった。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { replyToLine, type LineMessage } from "@/lib/line";

const TOKEN = "test-token";
const REPLY_TOKEN = "reply-token";
const MSGS: LineMessage[] = [{ type: "text", text: "hello" } as LineMessage];

/** D.O.T で実際に返ってきた 400 レスポンス。 */
const REAL_400 = JSON.stringify({
  message: "A message (messages[0]) in the request body is invalid",
  details: [
    { message: "invalid uri", property: "/contents/0/footer/contents/0/action/uri" },
    { message: "invalid uri scheme", property: "/contents/0/footer/contents/0/action/uri" },
  ],
});

function captureErrorLogs() {
  const lines: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  return lines;
}

describe("replyToLine — 送信結果を返す", () => {
  beforeEach(() => captureErrorLogs());
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("成功時は ok=true を返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await expect(replyToLine(REPLY_TOKEN, MSGS, TOKEN)).resolves.toMatchObject({ ok: true, status: 200 });
  });

  it("400 のとき ok=false と status を返す（従来は void で失敗が消えていた）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(REAL_400, { status: 400 })));
    const r = await replyToLine(REPLY_TOKEN, MSGS, TOKEN);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toContain("invalid uri");
  });

  it("ネットワークエラーでも throw せず ok=false を返す（webhook は 200 を返す必要がある）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    const r = await replyToLine(REPLY_TOKEN, MSGS, TOKEN);
    expect(r).toMatchObject({ ok: false, status: null });
    expect(r.error).toContain("boom");
  });

  it("送信対象なし / replyToken なしは成功扱い", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await expect(replyToLine("", MSGS, TOKEN)).resolves.toMatchObject({ ok: true });
    await expect(replyToLine(REPLY_TOKEN, [], TOKEN)).resolves.toMatchObject({ ok: true });
  });
});

describe("[line:delivery:failure] — 原因を特定できるログを出す", () => {
  let lines: string[];
  beforeEach(() => { lines = captureErrorLogs(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("LINE の details（どのプロパティが不正か）をログに載せる", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(REAL_400, { status: 400 })));
    await replyToLine(REPLY_TOKEN, MSGS, TOKEN);

    const line = lines.find((l) => l.includes("[line:delivery:failure]"));
    expect(line).toBeDefined();
    const payload = JSON.parse(line!.slice(line!.indexOf("{")));
    expect(payload.route).toBe("reply");
    expect(payload.status).toBe(400);
    expect(payload.lineMessage).toContain("in the request body is invalid");
    expect(payload.details).toEqual([
      { message: "invalid uri", property: "/contents/0/footer/contents/0/action/uri" },
      { message: "invalid uri scheme", property: "/contents/0/footer/contents/0/action/uri" },
    ]);
  });

  it("CMS のメッセージ ID を載せ、どの設定を直すべきか辿れるようにする", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(REAL_400, { status: 400 })));
    const withId = [{ type: "flex", altText: "アンケート", contents: {}, _sourceMessageId: "7bbbd272" }] as unknown as LineMessage[];
    await replyToLine(REPLY_TOKEN, withId, TOKEN);

    const line = lines.find((l) => l.includes("[line:delivery:failure]"))!;
    const payload = JSON.parse(line.slice(line.indexOf("{")));
    expect(payload.sourceMessageIds).toEqual(["7bbbd272"]);
    expect(payload.types).toEqual(["flex"]);
  });

  it("JSON でないエラー本文でも落ちず rawBody に載せる", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>gateway timeout</html>", { status: 504 })));
    await replyToLine(REPLY_TOKEN, MSGS, TOKEN);

    const line = lines.find((l) => l.includes("[line:delivery:failure]"))!;
    const payload = JSON.parse(line.slice(line.indexOf("{")));
    expect(payload.status).toBe(504);
    expect(payload.lineMessage).toBeNull();
    expect(payload.rawBody).toContain("gateway timeout");
  });

  it("成功時は failure ログを出さない", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await replyToLine(REPLY_TOKEN, MSGS, TOKEN);
    expect(lines.some((l) => l.includes("[line:delivery:failure]"))).toBe(false);
  });
});
